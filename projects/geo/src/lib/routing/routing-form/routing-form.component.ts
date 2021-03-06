import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  AfterViewInit,
  OnDestroy,
  Optional
} from '@angular/core';
import { FormGroup, FormBuilder, Validators, FormArray } from '@angular/forms';
import { Subscription, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';

import olFeature from 'ol/Feature';
import * as olgeom from 'ol/geom';
import * as olproj from 'ol/proj';
import * as olstyle from 'ol/style';
import * as olcondition from 'ol/events/condition';
import * as olinteraction from 'ol/interaction';
import * as olextent from 'ol/extent';
import * as olobservable from 'ol/Observable';

import { Clipboard } from '@igo2/utils';
import { Message, LanguageService, MessageService, RouteService } from '@igo2/core';

import { IgoMap } from '../../map/shared/map';
import { SearchService } from '../../search/shared/search.service';
import { VectorLayer } from '../../layer/shared/layers/vector-layer';
import { FeatureDataSource } from '../../datasource/shared/datasources/feature-datasource';

import { Routing } from '../shared/routing.interface';
import { RoutingService } from '../shared/routing.service';
import { RoutingFormService } from './routing-form.service';

import { QueryService } from '../../query/shared/query.service';

@Component({
  selector: 'igo-routing-form',
  templateUrl: './routing-form.component.html',
  styleUrls: ['./routing-form.component.scss']
})
export class RoutingFormComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly invalidKeys = ['Control', 'Shift', 'Alt'];

  public stopsForm: FormGroup;
  public projection = 'EPSG:4326';
  public currentStopIndex: number;
  private routesQueries$$: Subscription[] = [];

  private stream$ = new Subject<string>();

  public RoutingOverlayMarkerStyle: olstyle.Style;
  public RoutingOverlayStyle: olstyle.Style;
  public routingStopsOverlayDataSource: FeatureDataSource;
  public routingRoutesOverlayDataSource: FeatureDataSource;

  public routesResults: Routing[] | Message[];
  public activeRoute: Routing;
  private selectRoute;

  private focusOnStop = false;
  private focusKey = [];
  public initialStopsCoords;
  private browserLanguage;


  // https://stackoverflow.com/questions/46364852/create-input-fields-dynamically-in-angular-2

  @Input()
  get term() {
    return this._term;
  }
  set term(value: string) {
    this._term = value;
  }
  private _term = '';

  get debounce() {
    return this._debounce;
  }
  set debounce(value: number) {
    this._debounce = value;
  }
  private _debounce = 300;

  @Input()
  get length() {
    return this._length;
  }
  set length(value: number) {
    this._length = value;
  }
  private _length = 3;

  @Input()
  get map(): IgoMap {
    return this._map;
  }
  set map(value: IgoMap) {
    this._map = value;
  }
  private _map: IgoMap;

  @Output() submit: EventEmitter<any> = new EventEmitter();

  constructor(
    private formBuilder: FormBuilder,
    private routingService: RoutingService,
    private languageService: LanguageService,
    private messageService: MessageService,
    private searchService: SearchService,
    private queryService: QueryService,
    private routingFormService: RoutingFormService,
    @Optional() private route: RouteService
  ) {}

  changeRoute(selectedRoute: Routing) {
    this.showRouteGeometry();
  }

  ngOnDestroy(): void {
    this.unsubscribeRoutesQueries();
    this.unlistenSingleClick();
    this.queryService.queryEnabled = true;
    const stopCoordinates = [];

    this.stops.value.forEach(stop => {
      stopCoordinates.push(stop.stopCoordinates);
    });
    this.routingRoutesOverlayDataSource.ol.clear();
    this.routingStopsOverlayDataSource.ol.clear();
    this.routingFormService.setStopsCoordinates(stopCoordinates);
  }

  ngOnInit() {
    this.browserLanguage = this.languageService.getLanguage();
    this.stopsForm = this.formBuilder.group({
      routingType: 'car',
      routingMode: 'driving', // loop
      stopOrderPriority: true,
      routingFixedStartEnd: false,
      stops: this.formBuilder.array([
        this.createStop('start'),
        this.createStop('end')
      ])
    });

    this.routingStopsOverlayDataSource = new FeatureDataSource({});
    this.routingRoutesOverlayDataSource = new FeatureDataSource({});
  }

  ngAfterViewInit(): void {
    this.queryService.queryEnabled = false;
    this.focusOnStop = false;
    const stopsLayer = new VectorLayer({
      title: 'routingStopOverlay',
      zIndex: 999,
      id: 'routingStops',
      source: this.routingStopsOverlayDataSource
    });
    const routesLayer = new VectorLayer({
      title: 'routingRoutesOverlay',
      zIndex: 999,
      id: 'routingRoutes',
      opacity: 0.75,
      source: this.routingRoutesOverlayDataSource
    });

    this.map.addLayer(routesLayer, false);
    this.map.addLayer(stopsLayer, false);

    let selectedStopFeature;

    const selectStops = new olinteraction.Select({
      layers: [stopsLayer.ol],
      condition: olcondition.pointerMove,
      hitTolerance: 7
    });

    const translateStop = new olinteraction.Translate({
      layers: [stopsLayer.ol],
      features: selectedStopFeature
    });

    // TODO: Check to disable pointermove IF a stop is already selected
    const selectRouteHover = new olinteraction.Select({
      layers: [routesLayer.ol],
      condition: olcondition.pointerMove,
      hitTolerance: 7
    });

    this.selectRoute = new olinteraction.Select({
      layers: [routesLayer.ol],
      hitTolerance: 7
    });

    this.map.ol.on('pointermove', evt => {
      const selectRouteCnt = selectRouteHover.getFeatures().getLength();
      if (selectRouteCnt === 0) {
        this.routingFormService.unsetMapWaitingForRoutingClick();
      } else {
        this.routingFormService.setMapWaitingForRoutingClick();
      }
    });

    selectStops.on('select', evt => {
      selectedStopFeature = evt.target.getFeatures()[0];
    });

    this.selectRoute.on('select', evt => {
      if (this.focusOnStop === false) {
        const selectCoordinates = olproj.transform(
          evt['mapBrowserEvent'].coordinate,
          this.map.projection,
          this.projection
        );
        this.addStop();
        const pos = this.stops.length - 2;
        this.stops.at(pos).patchValue({ stopCoordinates: selectCoordinates });
        this.handleLocationProposals(selectCoordinates, pos);
        this.addStopOverlay(selectCoordinates, pos);
        this.selectRoute.getFeatures().clear();
      }
      this.selectRoute.getFeatures().clear();
    });

    this.routesQueries$$.push(
    this.stopsForm.statusChanges
      .pipe(debounceTime(this._debounce))
      .subscribe(val => this.onFormChange()));

    translateStop.on('translateend', evt => {
      const translatedID = evt.features.getArray()[0].getId();
      const translatedPos = translatedID.split('_');
      let p;
      switch (translatedPos[1]) {
        case 'start':
          p = 0;
          break;
        case 'end':
          p = this.stops.length - 1;
          break;
        default:
          p = Number(translatedPos[1]);
          break;
      }
      const translationEndCoordinates = olproj.transform(
        evt.features
          .getArray()[0]
          .getGeometry()
          .getCoordinates(),
        this.map.projection,
        this.projection
      );
      this.stops
        .at(p)
        .patchValue({ stopCoordinates: translationEndCoordinates });
      this.stops.at(p).patchValue({ stopProposals: [] });
      this.handleLocationProposals(translationEndCoordinates, p);
    });

    this.map.ol.addInteraction(selectStops);
    this.map.ol.addInteraction(selectRouteHover);
    this.map.ol.addInteraction(this.selectRoute);
    this.map.ol.addInteraction(translateStop);

    this.routesQueries$$.push(
    this.stream$
      .pipe(
        debounceTime(this._debounce),
        distinctUntilChanged()
      )
      .subscribe((term: string) => this.handleTermChanged(term)));
  }

  handleLocationProposals(coordinates: [number, number], stopIndex: number) {
    const groupedLocations = [];
    this.searchService
      .locate(coordinates, this.map.getZoom())
      .filter(searchRes => searchRes !== undefined)
      .map(res =>
        this.routesQueries$$.push(
        res.pipe(map(f => f)).subscribe(features => {
          (features as any).forEach(element => {
            if (
              groupedLocations.filter(f => f.source === element.source)
                .length === 0
            ) {
              groupedLocations.push({
                source: element.source,
                results: features
              });
            }
          });
          this.stops
            .at(stopIndex)
            .patchValue({ stopProposals: groupedLocations });
          // TODO: Prefer another source?
          if (features[0]) {
            if ((features[0] as any).source === 'ICherche Québec') {
              // prefer address type.
              let featurePos = 0;
              for (let i = 0; i < features.length; i++) {
                if (features[i]['properties']['type'] === 'adresse') {
                  featurePos = i;
                  break;
                }
              }
              this.stops
                .at(stopIndex)
                .patchValue({ stopPoint: features[featurePos].title });
              if ((features[featurePos] as any).geometry.type === 'Point') {
                this.stops.at(stopIndex).patchValue({
                  stopCoordinates: (features[featurePos] as any).geometry
                    .coordinates
                });
              } else {
                // Not moving the translated point Only to suggest value into the UI.
              }
            }
          } else {
            this.stops.at(stopIndex).patchValue({ stopPoint: coordinates });
            this.stops.at(stopIndex).patchValue({ stopProposals: [] });
          }
        }))
      );
  }

  routingText(index: number): string {
    if (index === 0) {
      return 'start';
    } else if (index === this.stops.length - 1 || this.stops.length === 1) {
      return 'end';
    } else {
      return 'intermediate';
    }
  }

  raiseStop(index: number) {
    if (index > 0) {
      this.moveStop(index, -1);
    }
  }

  lowerStop(index: number) {
    if (index < this.stops.length - 1) {
      this.moveStop(index, 1);
    }
  }

  moveStop(index, diff) {
    const fromValue = this.stops.at(index);
    this.removeStop(index);
    this.stops.insert(index + diff, fromValue);
    this.stops.at(index).patchValue({ routingText: this.routingText(index) });
    this.stops
      .at(index + diff)
      .patchValue({ routingText: this.routingText(index + diff) });
    if (this.stops.at(index).value.stopCoordinates) {
      this.addStopOverlay(this.stops.at(index).value.stopCoordinates, index);
    }
    if (this.stops.at(index + diff).value.stopCoordinates) {
      this.addStopOverlay(
        this.stops.at(index + diff).value.stopCoordinates,
        index + diff
      );
    }
  }

  get stops(): FormArray {
    return this.stopsForm.get('stops') as FormArray;
  }

  getStopsCoordinates(): [number, number][] {
    const stopCoordinates = [];
    this.stops.value.forEach(stop => {
      if (stop.stopCoordinates instanceof Array) {
        stopCoordinates.push(stop.stopCoordinates);
      }
    });
    this.routingFormService.setStopsCoordinates(stopCoordinates);
    return stopCoordinates;
  }

  addStop(): void {
    const insertIndex = this.stops.length - 1;
    this.stops.insert(insertIndex, this.createStop());
  }

  createStop(routingPos = 'intermediate'): FormGroup {
    return this.formBuilder.group({
      stopPoint: [''],
      stopProposals: [[]],
      routingText: routingPos,
      stopCoordinates: ['', [Validators.required]]
    });
  }

  removeStop(index: number): void {
    this.routingStopsOverlayDataSource.ol.clear();
    this.stops.removeAt(index);
    let cnt = 0;
    this.stops.value.forEach(stop => {
      this.stops.at(cnt).patchValue({ routingText: this.routingText(cnt) });
      this.addStopOverlay(this.stops.at(cnt).value.stopCoordinates, cnt);
      cnt++;
    });
  }

  resetForm() {
    this.routesResults = undefined;
    const nbStops = this.stops.length;
    for (let i = 0; i < nbStops; i++) {
      this.stops.removeAt(0);
    }
    this.stops.insert(0, this.createStop('start'));
    this.stops.insert(1, this.createStop('end'));
    this.routingStopsOverlayDataSource.ol.getFeatures().forEach(element => {
      this.deleteRoutingOverlaybyID(element.getId());
    });
    this.routingRoutesOverlayDataSource.ol.clear();
    this.routingStopsOverlayDataSource.ol.clear();
    this.selectRoute.getFeatures().clear();
  }

  onFormChange() {
    if (this.stopsForm.valid) {
      this.routingRoutesOverlayDataSource.ol.clear();
      const coords = this.getStopsCoordinates();
      if (coords.length >= 2) {
        this.getRoutes(coords);
      } else {
        this.routingRoutesOverlayDataSource.ol.clear();
      }
    }
  }

  formatStep(step, cnt) {
    return this.formatInstruction(
      step.maneuver.type,
      step.maneuver.modifier,
      step.name,
      step.maneuver.bearing_after,
      cnt,
      step.maneuver.exit,
      cnt === this.activeRoute.steps.length - 1
    );
  }

  formatInstruction(
    type,
    modifier,
    route,
    direction,
    stepPosition,
    exit,
    lastStep = false
  ) {
    let directiveFr;
    let directiveEn;
    let image = 'arrow_forward';
    let cssClass = 'rotate-270';
    const translatedDirection = this.translateBearing(direction);
    const translatedModifier = this.translateModifier(modifier);
    const enPrefix = modifier === 'straight' ? '' : 'on the ';
    const frPrefix = modifier === 'straight' ? '' : 'à ';

    let frAggregatedDirection = frPrefix + translatedModifier;
    let enAggregatedDirection = enPrefix + translatedModifier;

    if (modifier && modifier.search('slight') >= 0) {
      enAggregatedDirection = translatedModifier;
    }

    if (modifier === 'uturn') {
      image = 'fast_forward';
      cssClass = 'rotate-90';
    } else if (modifier === 'sharp right') {
      image = 'subdirectory_arrow_right';
      cssClass = 'icon-flipped';
    } else if (modifier === 'right') {
      image = 'subdirectory_arrow_right';
      cssClass = 'icon-flipped';
    } else if (modifier === 'slight right') {
      image = 'arrow_forward';
      cssClass = 'rotate-290';
    } else if (modifier === 'straight') {
      image = 'arrow_forward';
    } else if (modifier === 'slight left') {
      image = 'arrow_forward';
      cssClass = 'rotate-250';
    } else if (modifier === 'left') {
      image = 'subdirectory_arrow_left';
      cssClass = 'icon-flipped';
    } else if (modifier === 'sharp left') {
      image = 'subdirectory_arrow_left';
      cssClass = 'icon-flipped';
    }

    if (type === 'turn') {
      if (modifier === 'straight') {
        directiveFr = 'Continuer sur ' + route;
        directiveEn = 'Continue on ' + route;
      } else if (modifier === 'uturn') {
        directiveFr = 'Faire demi-tour sur ' + route;
        directiveEn = 'Make u-turn on ' + route;
      } else {
        directiveFr = 'Tourner ' + frAggregatedDirection + ' sur ' + route;
        directiveEn = 'Turn ' + translatedModifier + ' onto ' + route;
      }
    } else if (type === 'new name') {
      directiveFr =
        'Continuer en direction ' + translatedDirection + ' sur ' + route;
      directiveEn = 'Head ' + translatedDirection + ' on ' + route;
      image = 'explore';
      cssClass = '';
    } else if (type === 'depart') {
      directiveFr =
        'Aller en direction ' + translatedDirection + ' sur ' + route;
      directiveEn = 'Head ' + translatedDirection + ' on ' + route;
      image = 'explore';
      cssClass = '';
    } else if (type === 'arrive') {
      if (lastStep) {
        let coma = ', ';
        if (!translatedModifier) {
          frAggregatedDirection = '';
          enAggregatedDirection = '';
          coma = '';
        }
        directiveFr = 'Vous êtes arrivé' + coma + frAggregatedDirection;
        directiveEn =
          'You have reached your destination' + coma + enAggregatedDirection;
      } else {
        directiveFr = 'Vous atteignez le point intermédiare sur ' + route;
        directiveEn = 'You have reached the intermediate stop onto ' + route;
        image = 'location_on';
        cssClass = '';
      }
    } else if (type === 'merge') {
      directiveFr = 'Continuer sur ' + route;
      directiveEn = 'Continue on ' + route;
      image = 'arrow_forward';
      cssClass = 'rotate-270';
    } else if (type === 'on ramp') {
      directiveFr = 'Prendre l\'entrée d\'autoroute ' + frAggregatedDirection;
      directiveEn = 'Take the ramp ' + enAggregatedDirection;
    } else if (type === 'off ramp') {
      directiveFr = 'Prendre la sortie d\'autoroute ' + frAggregatedDirection;
      directiveEn = 'Take exit ' + enAggregatedDirection;
    } else if (type === 'fork') {
      if (modifier.search('left') >= 0) {
        directiveFr = 'Garder la gauche sur ' + route;
        directiveEn = 'Merge left onto ' + route;
      } else if (modifier.search('right') >= 0) {
        directiveFr = 'Garder la droite sur ' + route;
        directiveEn = 'Merge right onto ' + route;
      } else {
        directiveFr = 'Continuer sur ' + route;
        directiveEn = 'Continue on ' + route;
      }
    } else if (type === 'end of road') {
      directiveFr =
        'À la fin de la route, tourner ' + translatedModifier + ' sur ' + route;
      directiveEn =
        'At the end of the road, turn ' + translatedModifier + ' onto ' + route;
    } else if (type === 'use lane') {
      directiveFr = 'Prendre la voie de ... ';
      directiveEn = 'Take the lane ...';
    } else if (type === 'continue' && modifier !== 'uturn') {
      directiveFr = 'Continuer sur ' + route;
      directiveEn = 'Continue on ' + route;
      image = 'arrow_forward';
      cssClass = 'rotate-270';
    } else if (type === 'roundabout') {
      directiveFr = 'Au rond-point, prendre la ' + exit;
      directiveFr += exit === 1 ? 're' : 'e';
      directiveFr += ' sortie vers ' + route;
      directiveEn = 'At the roundabout, take the ' + exit;
      directiveEn += exit === 1 ? 'st' : 'rd';
      directiveEn += ' exit towards ' + route;
      image = 'donut_large';
      cssClass = '';
    } else if (type === 'rotary') {
      directiveFr = 'Rond-point rotary....';
      directiveEn = 'Roundabout rotary....';
      image = 'donut_large';
      cssClass = '';
    } else if (type === 'roundabout turn') {
      directiveFr = 'Rond-point, prendre la ...';
      directiveEn = 'Roundabout, take the ...';
      image = 'donut_large';
      cssClass = '';
    } else if (type === 'exit roundabout') {
      directiveFr = 'Poursuivre vers ' + route;
      directiveEn = 'Continue to ' + route;
      image = 'arrow_forward';
      cssClass = 'rotate-270';
    } else if (type === 'notification') {
      directiveFr = 'notification ....';
      directiveEn = 'notification ....';
    } else if (modifier === 'uturn') {
      directiveFr =
        'Faire demi-tour et continuer en direction ' +
        translatedDirection +
        ' sur ' +
        route;
      directiveEn =
        'Make u-turn and head ' + translatedDirection + ' on ' + route;
    } else {
      directiveFr = '???';
      directiveEn = '???';
    }

    if (lastStep) {
      image = 'flag';
      cssClass = '';
    }
    if (stepPosition === 0) {
      image = 'explore';
      cssClass = '';
    }

    let directive;
    if (this.browserLanguage === 'fr') {
      directive = directiveFr;
    } else if (this.browserLanguage === 'en') {
      directive = directiveEn;
    }

    return { instruction: directive, image: image, cssClass: cssClass };
  }

  translateModifier(modifier) {
    if (modifier === 'uturn') {
      return this.languageService.translate.instant('igo.geo.routing.uturn');
    } else if (modifier === 'sharp right') {
      return this.languageService.translate.instant(
        'igo.geo.routing.sharp right'
      );
    } else if (modifier === 'right') {
      return this.languageService.translate.instant('igo.geo.routing.right');
    } else if (modifier === 'slight right') {
      return this.languageService.translate.instant(
        'igo.geo.routing.slight right'
      );
    } else if (modifier === 'sharp left') {
      return this.languageService.translate.instant(
        'igo.geo.routing.sharp left'
      );
    } else if (modifier === 'left') {
      return this.languageService.translate.instant('igo.geo.routing.left');
    } else if (modifier === 'slight left') {
      return this.languageService.translate.instant(
        'igo.geo.routing.slight left'
      );
    } else if (modifier === 'straight') {
      return this.languageService.translate.instant('igo.geo.routing.straight');
    } else {
      return modifier;
    }
  }

  translateBearing(bearing) {
    if (bearing >= 337 || bearing < 23) {
      return this.languageService.translate.instant('igo.geo.cardinalPoints.n');
    } else if (bearing < 67) {
      return this.languageService.translate.instant(
        'igo.geo.cardinalPoints.ne'
      );
    } else if (bearing < 113) {
      return this.languageService.translate.instant('igo.geo.cardinalPoints.e');
    } else if (bearing < 157) {
      return this.languageService.translate.instant(
        'igo.geo.cardinalPoints.se'
      );
    } else if (bearing < 203) {
      return this.languageService.translate.instant('igo.geo.cardinalPoints.s');
    } else if (bearing < 247) {
      return this.languageService.translate.instant(
        'igo.geo.cardinalPoints.sw'
      );
    } else if (bearing < 293) {
      return this.languageService.translate.instant('igo.geo.cardinalPoints.w');
    } else if (bearing < 337) {
      return this.languageService.translate.instant(
        'igo.geo.cardinalPoints.nw'
      );
    } else {
      return;
    }
  }

  formatDistance(distance) {
    if (distance === 0) {
      return;
    }
    if (distance >= 100000) {
      return Math.round(distance / 1000) + ' km';
    }
    if (distance >= 10000) {
      return Math.round(distance / 100) / 10 + ' km';
    }
    if (distance >= 100) {
      return Math.round(distance / 100) / 10 + ' km';
    }
    return distance + ' m';
  }

  formatDuration(duration: number, summary = false) {
    if (duration >= 3600) {
      const hour = Math.floor(duration / 3600);
      const minute = Math.round((duration / 3600 - hour) * 60);
      if (minute === 60) {
        return hour + 1 + ' h';
      }
      return hour + ' h ' + minute + ' min';
    }

    if (duration >= 60) {
      return Math.round(duration / 60) + ' min';
    }
    return duration + ' s';
  }

  showSegment(step, zoomToExtent = false) {
    this.showRouteSegmentGeometry(step.geometry.coordinates, zoomToExtent);
  }

  showRouteSegmentGeometry(coordinates, zoomToExtent = false) {
    this.deleteRoutingOverlaybyID('endSegment');
    const geometry4326 = new olgeom.LineString(coordinates);
    const geometry3857 = geometry4326.transform('EPSG:4326', 'EPSG:3857');
    const routeSegmentCoordinates = (geometry3857 as any).getCoordinates();
    const lastPoint = routeSegmentCoordinates[0];

    const geometry = new olgeom.Point(lastPoint);
    const feature = new olFeature({ geometry: geometry });
    feature.setId('endSegment');

    if (geometry === null) {
      return;
    }
    if (geometry.getType() === 'Point') {
      feature.setStyle([
        new olstyle.Style({
          geometry: geometry,
          image: new olstyle.Circle({
            radius: 7,
            stroke: new olstyle.Stroke({ color: '#FF0000', width: 3 })
          })
        })
      ]);
    }
    if (zoomToExtent) {
      this.map.zoomToExtent(feature.getGeometry().getExtent());
    }
    this.routingRoutesOverlayDataSource.ol.addFeature(feature);
  }

  zoomRoute() {
    this.map.zoomToExtent(this.routingRoutesOverlayDataSource.ol.getExtent());
  }

  showRouteGeometry(moveToExtent = false) {
    const geom = this.activeRoute.geometry.coordinates;
    const geometry4326 = new olgeom.LineString(geom);
    const geometry3857 = geometry4326.transform('EPSG:4326', 'EPSG:3857');
    this.routingRoutesOverlayDataSource.ol.clear();
    const routingFeature = new olFeature({ geometry: geometry3857 });
    routingFeature.setStyle([
      new olstyle.Style({
        stroke: new olstyle.Stroke({ color: '#6a7982', width: 10 })
      }),
      new olstyle.Style({
        stroke: new olstyle.Stroke({ color: '#4fa9dd', width: 6 })
      })
    ]);
    this.routingRoutesOverlayDataSource.ol.addFeature(routingFeature);
    if (moveToExtent) {
      this.map.zoomToExtent(this.routingRoutesOverlayDataSource.ol.getExtent());
    }
  }

  getRoutes(stopsArrayCoordinates, moveToExtent = false) {
    const routeResponse = this.routingService.route(stopsArrayCoordinates);
    if (routeResponse) {
      routeResponse.map(res =>
        this.routesQueries$$.push(
        res.subscribe(route => {
          this.routesResults = route;
          this.activeRoute = this.routesResults[0] as Routing;
          this.showRouteGeometry(moveToExtent);
        }))
      );
    }
  }

  private unlistenSingleClick() {
    if (this.focusKey.length !== 0) {
      this.focusKey.forEach(key => {
        olobservable.unByKey(key);
      });
    }
  }

  private unsubscribeRoutesQueries() {
    this.routesQueries$$.forEach((sub: Subscription) => sub.unsubscribe());
    this.routesQueries$$ = [];
  }


  copyLinkToClipboard() {
    const successful = Clipboard.copy(this.getUrl());
    if (successful) {
      const translate = this.languageService.translate;
      const title = translate.instant('igo.geo.routingForm.dialog.copyTitle');
      const msg = translate.instant('igo.geo.routingForm.dialog.copyMsgLink');
      this.messageService.success(msg, title);
    }
  }

  copyDirectionsToClipboard() {
    const indent = '\t';
    let activeRouteDirective =
      this.languageService.translate.instant(
        'igo.geo.routingForm.instructions'
      ) + ':\n';
    let wayPointList = '';
    const summary =
      this.languageService.translate.instant('igo.geo.routingForm.summary') +
      ': \n' +
      indent +
      this.activeRoute.title +
      '\n' +
      indent +
      this.formatDistance(this.activeRoute.distance) +
      '\n' +
      indent +
      this.formatDuration(this.activeRoute.duration) +
      '\n\n' +
      this.languageService.translate.instant('igo.geo.routingForm.stopsList') +
      ':\n';

    const url =
      this.languageService.translate.instant('igo.geo.routingForm.link') +
      ':\n' +
      indent +
      this.getUrl();

    let wayPointsCnt = 1;
    this.stops.value.forEach(stop => {
      let coord = '';
      let stopPoint = '';
      if (stop.stopPoint !== stop.stopCoordinates) {
        stopPoint = stop.stopPoint;
        coord =
          ' (' +
          [stop.stopCoordinates[1], stop.stopCoordinates[0]].join(',') +
          ')';
      } else {
        stopPoint = [stop.stopCoordinates[1], stop.stopCoordinates[0]].join(
          ','
        );
      }

      wayPointList =
        wayPointList +
        indent +
        wayPointsCnt.toLocaleString() +
        '. ' +
        stopPoint +
        coord +
        '\n';
      wayPointsCnt++;
    });

    // Directions
    let localCnt = 0;
    this.activeRoute.steps.forEach(step => {
      const instruction = this.formatStep(step, localCnt).instruction;
      const distance =
        this.formatDistance(step.distance) === undefined
          ? ''
          : ' (' + this.formatDistance(step.distance) + ')';
      activeRouteDirective =
        activeRouteDirective +
        indent +
        (localCnt + 1).toLocaleString() +
        '. ' +
        instruction +
        distance +
        '\n';
      localCnt++;
    });

    const directionsBody =
      summary + wayPointList + '\n' + url + '\n\n' + activeRouteDirective;

    const successful = Clipboard.copy(directionsBody);
    if (successful) {
      const translate = this.languageService.translate;
      const title = translate.instant('igo.geo.routingForm.dialog.copyTitle');
      const msg = translate.instant('igo.geo.routingForm.dialog.copyMsg');
      this.messageService.success(msg, title);
    }
  }

  private handleTermChanged(term: string) {
    if (term !== undefined || term.length !== 0) {
      const searchProposals = [];
      const searchResponse = this.searchService.search(term);
      if (searchResponse) {
        searchResponse.map(res =>
          this.routesQueries$$.push(
          res.subscribe(features => {
            (features as any).filter(f => f.geometry).forEach(element => {
              if (
                searchProposals.filter(f => f.source === element.source)
                  .length === 0
              ) {
                searchProposals.push({
                  source: element.source,
                  results: features
                });
              }
            });
            this.stops
              .at(this.currentStopIndex)
              .patchValue({ stopProposals: searchProposals });
          }))
        );
      }
    }
  }

  setTerm(term: string) {
    this.term = term;
    if (
      this.keyIsValid(term) &&
      (term.length >= this.length || term.length === 0)
    ) {
      this.stream$.next(term);
    }
  }

  private keyIsValid(key: string) {
    return this.invalidKeys.find(value => value === key) === undefined;
  }

  keyup(i, event: KeyboardEvent) {
    const term = (event.target as HTMLInputElement).value;
    this.setTerm(term);
    this.map.ol.un('singleclick', evt => {
      this.handleMapClick(evt, i);
    });
  }

  clearStop(stopIndex) {
    this.deleteRoutingOverlaybyID(this.getStopOverlayID(stopIndex));
    this.stops.removeAt(stopIndex);
    this.stops.insert(stopIndex, this.createStop(this.routingText(stopIndex)));
    this.routingRoutesOverlayDataSource.ol.clear();
  }

  chooseProposal(proposal, i) {
    if (proposal !== undefined) {
      let geomCoord;
      const geom = (proposal as any).geometry;
      if (geom.type === 'Point') {
        geomCoord = geom.coordinates;
      } else if (geom.type.search('Line') >= 0) {
        let coordArray = [];
        if (geom.coordinates instanceof Array) {
          // Middle segment of multilinestring
          coordArray =
            geom.coordinates[Math.floor(geom.coordinates.length / 2)];
        } else {
          coordArray = geom.coordinates;
        }
        // middle point of coords
        geomCoord = coordArray[Math.floor(coordArray.length / 2)];
      } else if (geom.type.search('Polygon') >= 0) {
        const polygonExtent = proposal.extent;
        const long =
          polygonExtent[0] + (polygonExtent[2] - polygonExtent[0]) / 2;
        const lat =
          polygonExtent[1] + (polygonExtent[3] - polygonExtent[1]) / 2;
        geomCoord = [long, lat];
      }

      if (geomCoord !== undefined) {
        this.stops.at(i).patchValue({ stopCoordinates: geomCoord });
        this.addStopOverlay(geomCoord, i);
        const proposalExtent = this.routingStopsOverlayDataSource.ol
          .getFeatureById(this.getStopOverlayID(i))
          .getGeometry()
          .getExtent();

        if (!olextent.intersects(proposalExtent, this.map.getExtent())) {
          this.map.moveToExtent(proposalExtent);
        }
      }
    }
  }

  focus(i) {
    this.unlistenSingleClick();
    this.currentStopIndex = i;
    this.focusOnStop = true;
    this.routingFormService.setMapWaitingForRoutingClick();
    this.focusKey.push(this.map.ol.once('singleclick', evt => {
      this.handleMapClick(evt, i);
    }));
  }

  private handleMapClick(event: olcondition, indexPos?) {
    this.stops.at(indexPos).patchValue({ stopProposals: [] });
    if (this.currentStopIndex === undefined) {
      this.addStop();
      indexPos = this.stops.length - 2;
      this.stops.at(indexPos).value.stopProposals = [];
    } else {
      indexPos = this.currentStopIndex;
    }
    const clickCoordinates = olproj.transform(
      event.coordinate,
      this.map.projection,
      this.projection
    );
    this.stops.at(indexPos).patchValue({ stopCoordinates: clickCoordinates });

    this.handleLocationProposals(clickCoordinates, indexPos);
    this.addStopOverlay(clickCoordinates, indexPos);
    setTimeout(() => {
      this.focusOnStop = false; // prevent to trigger map click and Select on routes at same time.
    }, 500);
    this.routingFormService.unsetMapWaitingForRoutingClick();
  }

  geolocateStop(index: number) {
    this.map.moveToFeature(this.map.geolocationFeature);
    const geolocateCoordinates = this.map.getCenter(this.projection);
    this.stops.at(index).patchValue({ stopCoordinates: geolocateCoordinates });
    this.addStopOverlay(geolocateCoordinates, index);
    this.handleLocationProposals(geolocateCoordinates, index);
  }

  public addStopOverlay(coordinates: [number, number], index: number) {
    const routingText = this.routingText(index);
    let stopColor;
    let stopText;
    if (routingText === 'start') {
      stopColor = 'green';
      stopText = this.languageService.translate.instant(
        'igo.geo.routingForm.start'
      );
    } else if (routingText === 'end') {
      stopColor = 'red';
      stopText = this.languageService.translate.instant(
        'igo.geo.routingForm.end'
      );
    } else {
      stopColor = 'yellow';
      stopText =
        this.languageService.translate.instant(
          'igo.geo.routingForm.intermediate'
        ) +
        ' #' +
        index;
    }

    const geometry = new olgeom.Point(
      olproj.transform(coordinates, this.projection, this.map.projection)
    );
    const feature = new olFeature({ geometry: geometry });

    const stopID = this.getStopOverlayID(index);
    this.deleteRoutingOverlaybyID(stopID);
    feature.setId(stopID);

    if (geometry === null) {
      return;
    }
    if (geometry.getType() === 'Point') {
      feature.setStyle([this.map.setOverlayMarkerStyle(stopColor, stopText)]);
    }
    this.routingStopsOverlayDataSource.ol.addFeature(feature);
  }

  public getStopOverlayID(index: number): string {
    let txt;
    if (index === 0) {
      txt = 'start';
    } else if (index === this.stops.length - 1) {
      txt = 'end';
    } else {
      txt = index;
    }
    return 'routingStop_' + txt;
  }

  private deleteRoutingOverlaybyID(id) {
    if (this.routingStopsOverlayDataSource.ol.getFeatureById(id)) {
      this.routingStopsOverlayDataSource.ol.removeFeature(
        this.routingStopsOverlayDataSource.ol.getFeatureById(id)
      );
    }
    if (this.routingRoutesOverlayDataSource.ol.getFeatureById(id)) {
      this.routingRoutesOverlayDataSource.ol.removeFeature(
        this.routingRoutesOverlayDataSource.ol.getFeatureById(id)
      );
    }
  }

  private getUrl() {
    if (
      !this.route
    ) {
      return;
    }

    const routingKey = this.route.options.routingCoordKey;
    const stopsCoordinates = [];
    if (
      this.routingFormService &&
      this.routingFormService.getStopsCoordinates() &&
      this.routingFormService.getStopsCoordinates().length !== 0
    ) {
      this.routingFormService.getStopsCoordinates().forEach(coord => {
        stopsCoordinates.push(coord);
      });
    }
    let routingUrl = '';
    if (stopsCoordinates.length >= 2) {
      routingUrl = `${routingKey}=${stopsCoordinates.join(';')}`;
    }

    return `${location.origin}${
      location.pathname
    }?tool=directions&${routingUrl}`;
  }
}
