import { Component } from '@angular/core';

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
export class AppTimeFilterComponent {
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
      url: 'https://geoegl.msp.gouv.qc.ca/apis/ws/igo_gouvouvert.fcgi',
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

    const datasource2: TimeFilterableDataSourceOptions = {
      type: 'wms',
      url: 'https://geoegl.msp.gouv.qc.ca/apis/ws/geomet',
      params: {
        layers: 'HRDPA.6F_PR',
        version: '1.3.0'
      },
      optionsFromCapabilities: true
    };

    this.dataSourceService
      .createAsyncDataSource(datasource2)
      .subscribe(dataSource => {
        this.map.addLayer(
          this.layerService.createLayer({
            title: 'Quantité de précipitations',
            source: dataSource
          })
        );
      });
  }
}
