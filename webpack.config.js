const path = require('path');
const WebpackObfuscator = require('webpack-obfuscator');
const CopyPlugin = require('copy-webpack-plugin');
const fs = require('fs');

module.exports = {
  mode: 'production',
  target: 'node',

  entry: './index.js',

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'app.js',
    clean: true
  },

  externals: {
    'playwright': 'commonjs playwright'
  },


  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'swagger.json', to: 'swagger.json' },
        { from: 'swagger', to: 'swagger' },
        { 
          from: 'node_modules/swagger-ui-dist/swagger-ui-bundle.js', 
          to: 'swagger/swagger-ui-bundle.js' 
        },
        { 
          from: 'node_modules/swagger-ui-dist/swagger-ui-standalone-preset.js', 
          to: 'swagger/swagger-ui-standalone-preset.js' 
        },
        { 
          from: 'node_modules/swagger-ui-dist/swagger-ui.css', 
          to: 'swagger/swagger-ui.css' 
        },
        { 
          from: 'node_modules/swagger-ui-dist/favicon-32x32.png', 
          to: 'swagger/favicon-32x32.png' 
        },
        { 
          from: 'node_modules/swagger-ui-dist/favicon-16x16.png', 
          to: 'swagger/favicon-16x16.png' 
        },
        { 
          from: '.env', 
          to: '.env',
          toType: 'file',
          noErrorOnMissing: true
        },
        { 
          from: 'auth', 
          to: 'auth',
          noErrorOnMissing: true 
        },
        { 
          from: 'scripts/setup_domain.bat', 
          to: 'setup_domain.bat' 
        },
        { 
          from: 'scripts/HUONG_DAN.md', 
          to: 'HUONG_DAN.md' 
        },
        { 
          from: 'scripts/install.bat', 
          to: 'install.bat' 
        },
        { 
          from: 'assets/icon/img.ico', 
          to: 'swagger/img.ico',
          noErrorOnMissing: true
        },
        { from: 'scripts/package.dist.json', to: 'package.json' }
      ]
    }),
    /*
    new WebpackObfuscator({
      rotateStringArray: true,
      stringArray: true,
      stringArrayThreshold: 0.75,
      debugProtection: false,
      debugProtectionInterval: 0,
      disableConsoleOutput: false,
      selfDefending: false,
      compact: true,
      splitStrings: true,
      unicodeEscapeSequence: false
    })
    */
  ]
};
