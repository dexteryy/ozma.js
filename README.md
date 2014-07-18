<!---
layout: intro
title: OzmaJS
-->

# OzmaJS

> * Intelligent autobuild tool for [OzJS](http://ozjs.org)

## Install

```
npm install -g ozma
```

## Usage

```
ozma [build script] --config [configuration file]
```

## Examples

* [ozma-demo](https://github.com/dexteryy/ozma-demo)

#### Old examples

* [demo1: for production or development](http://ozjs.org/ozma/examples/demo1.html)
* [demo2: for development](http://ozjs.org/ozma/examples/demo2.html)
* [demo3: for production](http://ozjs.org/ozma/examples/demo3.html)
* [demo4: for third party package manager](http://ozjs.org/ozma/examples/demo4.html)

## Supported options

* `-c` or `--config` — 指定配置文件，可省略，默认读取输入文件(`build script`)同级目录下的`ozconfig.json`作为配置文件
* `-s` or `--silent` — 不打印任何提示信息，除了错误信息
* `--library-release` — 以库的形式构建发布文件，不包含build script，不在require.config添加ozma的记录
* `--enable-modulelog` — 允许js文件中的console信息打印在终端里

## Integration with...

* [grunt-ozjs](https://github.com/dexteryy/grunt-ozjs): Grunt tasks for oz.js and ozma.js 
* [gulp-ozjs](https://github.com/kebot/gulp-ozjs): gulp tasks for oz.js and ozma.js

## Source code

* [View on Github](https://github.com/dexteryy/ozma.js)

## More References

See [OzJS References](http://ozjs.org/#ref)

## License

Copyright (c) 2010 - 2013 dexteryy  
Licensed under the MIT license.

