const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',
  target: 'node',

  entry: './index.js',

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'app.js',
    clean: true
  },

  optimization: {
    minimize: true
  },

  externals: {
    // không bundle native modules nếu có
  },

  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'swagger.json', to: 'swagger.json' },
        { from: 'swagger', to: 'swagger' }
      ]
    })
  ]
};
