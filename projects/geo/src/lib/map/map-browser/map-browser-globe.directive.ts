import { Directive, Self, AfterViewInit } from '@angular/core';

import OLCesium from 'ol-cesium/dist/olcesium.js';

import { MapService } from '../shared/map.service';
import { MapBrowserComponent } from './map-browser.component';

@Directive({
  selector: '[igoMapBrowserGlobe]'
})
export class MapBrowserGlobeDirective implements AfterViewInit {
  private component: MapBrowserComponent;

  constructor(
    @Self() component: MapBrowserComponent,
    private mapService: MapService
  ) {
    this.component = component;
  }

  ngAfterViewInit() {
    window['CESIUM_BASE_URL'] = '/assets/cesium/';
    const ol3d = new OLCesium({ map: this.component.map.ol });
    ol3d.setEnabled(true);
  }
}
