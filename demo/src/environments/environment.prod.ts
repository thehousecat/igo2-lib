interface Environment {
  production: boolean;
  igo: any;
}

export const environment: Environment = {
  production: true,
  igo: {
    auth: {
      intern: {
        enabled: true
      }
    },
    language: {
      prefix: './locale/'
    },
    catalog: {
      sources: [
        {
          title: 'Gouvouvert',
          url: 'https://geoegl.msp.gouv.qc.ca/igo2/api/ws/igo_gouvouvert.fcgi'
        }
      ]
    },
    searchSources: {
      nominatim: {
        enabled: false
      },
      icherche: {
        url: 'https://geoegl.msp.gouv.qc.ca/icherche/geocode'
      },
      datasource: {
        url: 'https://geoegl.msp.gouv.qc.ca/igo2/api/layers/search'
      }
    }
  }
};
