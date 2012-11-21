# Ozma.js 

Intelligent autobuild tool for [OzJS](http://ozjs.org)

## Install:
    npm install -g ozma

## Usage: 
    ozma [build script] --config [configuration file]

## Supported options:
* `-c` or `--config` — 指定配置文件，可省略，默认读取输入文件(`build script`)同级目录下的`ozconfig.json`作为配置文件
* `-s` or `--silent` — 不打印任何提示信息
* `--jam` — 基于Jam的package目录自动生成配置和发布文件
* `--enable-modulelog` — 允许js文件中的console信息打印在终端里

## Examples (with docs):
* [demo1: for production or development](http://ozjs.org/examples/buildtool/demo1.html)
* [demo2: for development](http://ozjs.org/examples/buildtool/demo2.html)
* [demo3: for production](http://ozjs.org/examples/buildtool/demo3.html)
* [demo4: for third party package manager](http://ozjs.org/examples/buildtool/demo4.html)

## Grunt plugin:

[grunt-ozjs](https://github.com/dexteryy/grunt-ozjs) enables you to use [grunt.js gruntfile](https://github.com/gruntjs/grunt/blob/master/docs/getting_started.md) to configure `ozma` and integrate with other [grunt tasks](http://gruntjs.com/)

## Source code:
* [View on Github](https://github.com/dexteryy/ozma.js)
