import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { LanguageService } from '@igo2/core';
import {
  IgoMap,
  DataSourceService,
  LayerService,
  TimeFilterableDataSourceOptions,
  Layer
} from '@igo2/geo';

@Component({
  selector: 'app-time-filter',
  templateUrl: './time-filter.component.html',
  styleUrls: ['./time-filter.component.scss']
})
export class AppTimeFilterComponent implements OnInit, OnDestroy {
  public map = new IgoMap({
    controls: {
      attribution: {
        collapsed: true
      }
    }
  });

  public view = {
    center: [-73, 47.2],
    zoom: 7
  };

  private layers$$: Subscription;
  public layers: Layer[];

  constructor(
    private languageService: LanguageService,
    private dataSourceService: DataSourceService,
    private layerService: LayerService
  ) {
    this.dataSourceService
      .createAsyncDataSource({
        type: 'osm'
      })
      .subscribe(dataSource => {
        this.map.addLayer(
          this.layerService.createLayer({
            title: 'OSM',
            source: dataSource
          })
        );
      });

    const datasource: TimeFilterableDataSourceOptions = {
      type: 'wms',
      url: 'https://testgeoegl.msp.gouv.qc.ca/apis/ws/igo_gouvouvert.fcgi',
      params: {
        layers: 'vg_observation_v_inondation_embacle_wmst',
        version: '1.3.0'
      },
      optionsFromCapabilities: true
      /*timeFilterable: true,
      timeFilter: {
        min: '2017-01-01',
        max: '2018-01-01',
        range: true,
        type: 'datetime',
        style: 'slider',
        step: 86400000,
        timeInterval: 2000
      }*/
    };

    this.dataSourceService
      .createAsyncDataSource(datasource)
      .subscribe(dataSource => {
        this.map.addLayer(
          this.layerService.createLayer({
            title: 'Embâcle',
            source: dataSource
          })
        );
      });
  }

  ngOnInit() {
    this.layers$$ = this.map.layers$.subscribe(layers => {
      this.layers = layers;
    });
  }

  ngOnDestroy() {
    this.layers$$.unsubscribe();
  }
}
