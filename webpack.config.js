const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env) => [
  {
    mode: 'production',

    target: 'web',

    // Builds with devtool support (development) contain very big eval chunks,
    // which seem to cause segfaults (at least) on nodeJS v0.12.2 used on webOS 3.x.
    // This feature makes sense only when using recent enough chrome-based
    // node inspector anyway.
    // devtool: 'source-map',

    entry: {
      userScript: './src/userScript.js'
    },
    output: {
      path: '/home/yasich217/Documents/github/YouTubeTV-adfree/renderers/main',
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    module: {
      rules: [
        // {
        //   test: /\.m?js$/,
        //   loader: 'babel-loader',
        //   exclude: [
        //     // Some module should not be transpiled by Babel
        //     // See https://github.com/zloirock/core-js/issues/743#issuecomment-572074215
        //     // \\ for Windows, / for macOS and Linux
        //     /node_modules[\\/]core-js/,
        //     /node_modules[\\/]webpack[\\/]buildin/
        //   ],
        //   options: {
        //     cacheDirectory: true
        //   }
        // },
        {
          test: /\.tsx?$/,
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
          exclude: /dist/,
        },
      ]
    },
  }
];
