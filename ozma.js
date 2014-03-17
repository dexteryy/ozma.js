#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var optimist = require('optimist');

var INDENTx1 = '';
var STEPMARK = '\033[34m==>\033[0m';
var RE_AUTOFIXNAME = /define\((?=[^'"])/;
var RE_AUTOARGS = /define\(([^\[\]]*?)function\((.*?)\)\{/g;
var RE_REQUIRE = /(^|\s)require\(\s*(\[[^\]]*\]|[^\)]+?)\s*\,/gm;
var RE_REQUIRE_VAL = /(require\(\s*)(['"].+?['"])\)/g;
var RE_REQUIRE_DEPS = /(^|[^\S\n\r]*)(require\(\s*)(\[[^\]]*\])/g;
var RE_DEFINE_DEPS = /(^|[^\S\n\r]*)(define\(\s*[^\[\),]+,\s*)(\[[^\]]*\])/g;
var CONFIG_BUILT_CODE = '\nrequire.config({ enable_ozma: true });\n\n';
var _DEFAULT_CONFIG = {
    "baseUrl": "./",
    "distUrl": null,
    "jamPackageDir": null,
    "loader": null,
    "ignore": null,
    "disableAutoSuffix": false 
};

function ozma(opt){

    opt = opt || {};
    var logger = opt.logger || Object.create(console);

    delete require.cache[require.resolve('ozjs')];
    var oz = require('ozjs').oz;
    var origin_oz = oz.origin;

    var _runtime;
    var _config = {};
    var _build_script = '';
    var _loader_config_script = '';
    var _current_scope_file;
    var _capture_require;
    var _require_holds = [];
    var _scripts = {};
    var _refers = {};
    var _delays= {};
    var _code_cache = {};
    var _code_bottom = '';
    var _mods_code_cache = {};
    var _file_scope_mods = {};
    var _file_scope_scripts = {};
    var _build_history = {};
    var _lazy_loading = [];
    var _is_global_scope = true;
    var _delay_exec;
    var _loader_readed;
    var _output_count = 0;
    var _begin_time;
    var _complete_callback;
    var _is_library_release = false;

    /**
     * implement hook
     */
    oz.require = function(deps){
        if (_capture_require) {
            _require_holds.push.apply(_require_holds, typeof deps === 'string' ? [deps] : deps);
        } else {
            return origin_oz.require.apply(this, arguments);
        }
    };

    oz.require.config = origin_oz.require.config;

    /**
     * implement hook
     */
    oz.exec = function(list){
        var output_mods = [], output_code = '', count = 0;
        if (_is_global_scope) {
            var loader = _config.loader || oz.cfg.loader;
            if (loader) {
                if (_loader_readed) {
                    list.push({
                        name: '__loader__',
                        url: loader
                    });
                } else {
                    return _delay_exec = function(){
                        oz.exec(list);
                    };
                }
            } else if (!_is_library_release) {
                output_code += CONFIG_BUILT_CODE;
            }
        }
        logger.log(STEPMARK, 'Building');
        if (_is_library_release) {
            list = list.slice(1);
        }
        list.reverse().forEach(function(mod){
            var mid = mod.name;
            if (mod.is_reset) {
                mod = oz.cfg.mods[mid];
            }
            if (mod.url || !mid) {
                if (mod.built 
                    || !mid && !_is_global_scope) {
                    if (mod.built) {
                        logger.warn('\033[33m', 'ignore: ', mod.url, '\033[0m');
                    }
                    return;
                }
                var import_code = this[mid || ''];
                if (!import_code) {
                    return;
                }
                output_mods.push(mod);

                // semicolons are inserted between files if concatenating would cause errors.
                output_code += '\n/* @source ' + (mod.url || '') + ' */;\n\n'
                                + import_code;
                if (mid !== '__loader__') {
                    _mods_code_cache[_build_script].push([mid, import_code]);
                } else if (_is_global_scope) {
                    if (_loader_config_script) {
                        output_code += _loader_config_script;
                    }
                    if (!_is_library_release) {
                        output_code += CONFIG_BUILT_CODE;
                    }
                }
                if (mod.url && mod.url !== _build_script) {
                    count++;
                    logger.log(INDENTx1, '\033[36m' + 'import: ', mod.url + '\033[0m');
                }
                mod.built = true;
            }
        }, _code_cache);
        var output = _config.disableAutoSuffix ? _build_script 
                                    : oz.namesuffix(_build_script);
        if (!_is_global_scope) {
            output = path.join(_config.distUrl || _config.baseUrl, output);
        } else if (_config.distUrl) {
            output = path.join(_config.distUrl, 
                relative_path(output, _config.baseUrl));
        }
        output_code += _code_bottom;

        var _writeCallback = function(err){
            if (err) {
                throw err;
            }
            logger.log(INDENTx1, count, 'files');
            logger.log(INDENTx1, 'target: ', '\033[4m' + output + '\033[0m');
            logger.log(INDENTx1, 'Success!\n');
            _output_count++;
            _is_global_scope = false;
            if (!seek_lazy_module()) {
                logger.log(_output_count + ' files, built in ' 
                            + (+new Date() - _begin_time) + 'ms');
                if (_complete_callback) {
                    _complete_callback();
                }
            }
        };
        if(opt.pipe) { // is pipe
            return opt.pipe(output, output_code, output_mods, _writeCallback);
        }
        return writeFile3721(output, output_code, _writeCallback);
    };

    /**
     * implement hook
     */
    oz.fetch = function(m, cb){
        var url = m.url,
            is_undefined_mod,
            observers = _scripts[url];
        if (!observers) {
            var mname = m.name, delays = _delays;
            if (m.deps && m.deps.length && delays[mname] !== 1) {
                delays[mname] = [m.deps.length, cb];
                m.deps.forEach(function(dep){
                    var d = oz.cfg.mods[oz.realname(dep)];
                    if (this[dep] !== 1 && d.url && d.loaded !== 2) {
                        if (!this[dep]) {
                            this[dep] = [];
                        }
                        this[dep].push(m);
                    } else {
                        delays[mname][0]--;
                    }
                }, _refers);
                if (delays[mname][0] > 0) {
                    return;
                } else {
                    delays[mname] = 1;
                }
            }
            observers = _scripts[url] = [[cb, m]];
            read(m, function(data){
                var _mods = oz.cfg.mods;
                if (data) {
                    try {
                        _capture_require = true;
                        vm.runInContext(data, _runtime);
                        _capture_require = false;
                        merge(_mods[m.name].deps, _require_holds);
                        _require_holds.length = 0;
                    } catch(ex) {
                        logger.info(INDENTx1, '\033[33m' + 'Unrecognized module: ', m.name + '\033[0m');
                        _capture_require = false;
                        _require_holds.length = 0;
                    }
                    if (_mods[m.name] === m) {
                        is_undefined_mod = true;
                    }
                }
                observers.forEach(function(args){
                    args[0].call(args[1]);
                });
                if (data) {
                    auto_fix_anon(_mods[m.name]);
                    if (is_undefined_mod) {
                        if (_mods[m.name] === m) {
                            _code_cache[m.name] += '\n/* autogeneration */' 
                                + '\ndefine("' + m.name + '", [' 
                                + (m.deps && m.deps.length ? ('"' + m.deps.join('", "') + '"') : '')
                                + '], function(){});\n';
                        } else {
                            auto_fix_name(m.name);
                        }
                    }
                    auto_fix_deps(_mods[m.name]);
                }
                _scripts[url] = 1;
                if (_refers[mname] && _refers[mname] !== 1) {
                    _refers[mname].forEach(function(dm){
                        var b = this[dm.name];
                        if (--b[0] <= 0) {
                            this[dm.name] = 1;
                            oz.fetch(dm, b[1]);
                        }
                    }, delays);
                    _refers[mname] = 1;
                }
            });
        } else if (observers === 1) {
            cb.call(m);
        } else {
            observers.push([cb, m]);
        }
    };

    function read(m, cb){
        var file = path.resolve(path.join(_config.baseUrl, m.url));
        if (!fs.existsSync(file)) {
            setTimeout(function(){
                logger.log(INDENTx1, '\033[33m' + 'Undefined module: ', m.name + '\033[0m');
                cb();
            }, 0);
            return;
        }
        fs.readFile(file, 'utf-8', function(err, data){
            if (err) {
                return logger.error("\033[31m", 'ERROR: Can not read "' + file + '"\033[0m');
            }
            if (data) {
                _code_cache[m.name] = data;
            }
            cb(data);
        });
    }

    function seek_lazy_module(){
        if (!_lazy_loading.length) {
            var code, clip;
            for (var file in _mods_code_cache) {
                code = _mods_code_cache[file];
                clip = code.pop();
                _current_scope_file = file;
                break;
            }
            if (!clip) {
                delete _mods_code_cache[file];
                if (!code) {
                    return false;
                } else {
                    return seek_lazy_module();
                }
            }
            var r;
            while (r = RE_REQUIRE.exec(clip[1])) {
                if (r[2]) {
                    var deps_str = r[2].trim();
                    try {
                        if (!/^\[/.test(deps_str)) {
                            deps_str = '[' + deps_str + ']';
                        }
                        _lazy_loading.push.apply(_lazy_loading, eval(deps_str));
                    } catch (ex) {
                        logger.warn(STEPMARK, 'Ignore\n', '\033[33m'
                            + r[0].replace(/\n/g, '').replace(/\s/g, '')
                            + '...\033[0m\n');
                        continue;
                    }
                }
            }
            if (!_lazy_loading.length) {
                return seek_lazy_module();
            }
            unique(_lazy_loading);
            if (clip[0]) {
                logger.log(STEPMARK, 'Analyzing dynamic dependencies inside', '"' + clip[0] 
                            + '"(included in', '\033[4m' + _current_scope_file + '\033[0m)');
                logger.log('\033[36m', _lazy_loading.map(function(str){
                    return 'require: "' + str + '"';
                }).join('\n '), '\033[0m', '\n');
            }
        }
        var mid = _lazy_loading.pop();
        if (!mid) {
            return false;
        }
        var mods = _file_scope_mods[_current_scope_file];
        var scripts = _file_scope_scripts[_current_scope_file];
        var m = mods[oz.realname(mid)];
        if (m && m.loaded == 2) {
            return seek_lazy_module();
        }
        var new_build = m && m.url || oz.filesuffix(oz.realname(mid));
        if (_build_history[new_build]) {
            //return seek_lazy_module();
            var last_build = _build_history[new_build];
            mods = interset(copy(last_build[0], 1), mods);
            scripts = interset(copy(last_build[1], 1), scripts);
        }
        _build_history[new_build] = [mods, scripts];

        oz.cfg.mods = copy(mods, 1);
        _scripts = copy(scripts, 1);

        switch_build_script(new_build);

        logger.log(STEPMARK, 'Running', '"' + mid + '"(' + '\033[4m' + new_build + '\033[0m' + ')', 'as build script');
        logger.log(STEPMARK, 'Analyzing');
        oz.require(mid, function(){});
        return true;
    }

    function switch_build_script(url){
        _build_script = url;
        _mods_code_cache[_build_script] = [];
        _file_scope_mods[url] = oz.cfg.mods;
        _file_scope_scripts[url] = _scripts;
    }

    function relative_path(origin, target){
        target = path.resolve(target).split(path.sep);
        origin = path.resolve(origin).split(path.sep);
        var file = origin.pop();
        var output = [];
        for (var i = 0; i < target.length; i++) {
            if (target[i] !== origin[i]) {
                for (var j = 0; j < target.length - i; j++) {
                    output.push('..');
                }
                break;
            }
        }
        if (origin[i]) {
            output = output.concat(origin.slice(i));
        }
        output.push(file);
        return output.join(path.sep);
    }

    function auto_fix_name(mid){
        _code_cache[mid] = _code_cache[mid].replace(RE_AUTOFIXNAME, function($0){
            return $0 + '"' + mid + '", ';
        });
    }

    function auto_fix_anon(mod){
        var hiddenDeps = [];
        (mod.block && mod.block.hiddenDeps || []).forEach(function(mid){
            var unique_mid = oz.realname(oz.basename(mid, mod));
            if (!this[unique_mid]) {
                this[unique_mid] = true;
                hiddenDeps.push(mid);
            }
        }, {});
        if (hiddenDeps.length) {
            _code_cache[mod.name] = _code_cache[mod.name].replace(RE_AUTOARGS, function($0, $1, $2){
                return 'define(' + $1 
                    + (hiddenDeps.length ? ('["' + hiddenDeps.join('", "') + '"]') : '[]')
                    + ', function(' 
                    + ($2 && hiddenDeps.length 
                        ? hiddenDeps.map(function(n, i){
                            return '__oz' + i;
                        }).join(', ') + ', ' : '') 
                    + $2 + '){';
            });
        }
    }

    function auto_fix_deps(mod){
        _code_cache[mod.name] = _code_cache[mod.name]
            .replace(RE_REQUIRE_VAL, function($0, $1, $2){
                var dep = eval($2);
                return $1 + '"' + oz.basename(dep, mod) + '")';
            })
            .replace(RE_REQUIRE_DEPS, tidy)
            .replace(RE_DEFINE_DEPS, tidy);
        function tidy($0, $1, $2, $3){
            var deps = eval($3);
            if (typeof deps === 'string') {
                deps = [deps];
            }
            deps = deps.map(function(dep){
                return oz.basename(dep, mod);
            });
            return $1 + $2 + (deps.length ? 
                ('[\n' + $1 + '  "' + deps.join('",\n' + $1 + '  "') + '"\n' + $1 + ']') 
                : $3);
        }
    }

    function load_config(file){
        if (!fs.existsSync(file)) {
            return false;
        }
        var json;
        try {
            json = JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch(ex) {
            logger.error("\033[31m", 'ERROR: Can not parse', file, ' [' 
                + ex.toString().replace(/\s*\n/g, '') + ']', "\033[0m");
            throw ex;
        }
        config(_config, json, _DEFAULT_CONFIG);
        return _config;
    }

    function main(args, callback, opt){
        opt = opt || {};
        _complete_callback = callback;
        _begin_time = +new Date();
        var input_dir = path.dirname(args._[0]);

        if (args['silent']) {
            disable_methods(logger);
        }

        if (args['library-release']) {
            _is_library_release = true;
        }

        if (!_config["baseUrl"]) {
            logger.log(STEPMARK, 'Configuring');
            var cfg, input_config = args['config'];
            if (input_config) {
                cfg = typeof input_config === 'string' 
                    ? load_config(args['config'])
                    : config(_config, input_config, _DEFAULT_CONFIG);
            }
            if (!cfg) {
                cfg = load_config(path.join(input_dir, 'ozconfig.json'));
            }
            if (!cfg) {
                cfg = config(_config, _DEFAULT_CONFIG, _DEFAULT_CONFIG);
                logger.warn("\033[33m", "Can not find config file, using defaults: ", "\033[0m", 
                    "\n", '\033[36m', cfg, '\033[0m');
            }
        }

        if (!_runtime) {
            var doc = require("jsdom-nogyp").jsdom("<html><head></head><body></body></html>");
            var win = merge({
                oz: oz,
                define: oz.define,
                require: oz.require,
                console: Object.create(logger),
                process: process
            }, doc.createWindow());
            _runtime = vm.createContext(win);
            _runtime.window = _runtime;

            if (_config.ignore) {
                _config.ignore.forEach(function(mid){
                    oz.define(mid, [], function(){});
                });
            }

            if (args['jam']) {
                logger.log(STEPMARK, 'Building for Jam');
                var jam_dir = _config.jamPackageDir || 'jam/';
                var jam_path = path.join(_config.baseUrl, jam_dir);
                fs.readFile(jam_path + 'require.config.js', 'utf-8', function(err, data){
                    if (err) {
                        return logger.error("\033[31m", 'ERROR: Directory "' + jam_path + '" not found in the current path', "\033[0m");
                    }
                    vm.runInContext(data, _runtime);
                    var autoconfig = _runtime.jam.packages.map(function(m){
                        return 'define("' + m.name + '", "' 
                            + path.join(jam_dir, (/[^\/]+$/.exec(m.location)[0]), m.main) 
                            + '");\n';
                    }).join('');
                    vm.runInContext(autoconfig, _runtime);
                    _config.loader = jam_dir + 'oz.js';
                    fs.readFile(
                        path.join(
                            path.dirname(/\S+$/.exec(module.filename)[0]), 
                            'node_modules/ozjs/oz.js'
                        ), 'utf-8', function(err, data){
                        writeFile3721(path.join(jam_path, 'oz.config.js'), [autoconfig].join('\n'), function(){
                            logger.log(INDENTx1, 'updating', '\033[4m' + path.join(jam_path, 'oz.config.js') + '\033[0m');
                            writeFile3721(path.join(jam_path, 'oz.js'), [data, autoconfig].join('\n'), function(){
                                logger.log(INDENTx1, 'updating', '\033[4m' + _config.loader + '\033[0m');
                                if (args._.length) {
                                    main(args, callback, { 
                                        loader: _config.loader, 
                                        loader_config: autoconfig 
                                    });
                                }
                            });
                        });
                    });
                });
                return;
            }
        }

        if (!args._.length) {
            optimist.showHelp(logger.warn);
            logger.error("\033[31m", 'ERROR: Missing input file', "\033[0m");
            return false;
        }

        switch_build_script(args._[0]);
        _current_scope_file = _build_script;

        if (!args['enable-modulelog']) {
            disable_methods(_runtime.console);
        }

        fs.readFile(_build_script, 'utf-8', function(err, data){
            if (err) {
                return logger.error("\033[31m", 'ERROR: Can not read "' + _build_script + '"\033[0m');
            }
            _code_cache[''] = data;
            logger.log(STEPMARK, 'Analyzing');
            _capture_require = true;
            vm.runInContext(data, _runtime);
            _capture_require = false;
            oz.define('__main__', _require_holds.slice(), function(){});
            _require_holds.length = 0;
            oz.require('__main__', function(){});
            //read loader script
            var loader = _config.loader || oz.cfg.loader;
            if (loader) {
                if (opt.loader !== loader) {
                    _loader_config_script = opt.loader_config;
                }
                read({
                    name: '__loader__',
                    url: loader
                }, function(){
                    _loader_readed = true;
                    if (_delay_exec) {
                        _delay_exec();
                    }
                });
            }
        });
    }

    return {
        exec: main
    };

}

function merge(origins, news){
    if (Array.isArray(origins)) {
        var lib = {};
        origins.forEach(function(i){
            lib[i] = 1;
        }, lib);
        news.forEach(function(i){
            if (!this[i]) {
                origins.push(i);
            }
        }, lib);
    } else {
        for (var i in news) {
            if (!origins.hasOwnProperty(i)) {
                origins[i] = news[i];
            }
        }
    }
    return origins;
}

function config(cfg, opt, default_cfg){
    for (var i in default_cfg) {
        if (opt.hasOwnProperty(i)) {
            if (default_cfg[i] && typeof default_cfg[i] === 'object' && !Array.isArray(opt[i])) {
                if (!cfg[i]) {
                    cfg[i] = default_cfg[i];
                }
                for (var j in opt[i]) {
                    cfg[i][j] = opt[i][j];
                }
            } else {
                cfg[i] = opt[i];
            }
        } else if (typeof cfg[i] === 'undefined') {
            cfg[i] = default_cfg[i];
        }
    }
    return cfg;
}

function interset(origin, other){
    for (var i in origin) {
        if (!other.hasOwnProperty(i)) {
            delete origin[i];
        }
    }
    return origin;
}

function copy(obj, lvl) {
    lvl = lvl || 0;
    if (!obj || lvl < 0) {
        return obj;
    }
    var newo;
    if (Array.isArray(obj)) {
        newo = [];
        for (var i = 0, l = obj.length; i < l; i++) {
            if (typeof obj[i] === 'object') {
                newo[i] = copy(obj[i], lvl - 1);
            } else {
                newo[i] = obj[i];
            }
        }
    } else {
        newo = {};
        for (var p in obj) {
            if (typeof obj[p] === 'object') {
                newo[p] = copy(obj[p], lvl - 1);
            } else {
                newo[p] = obj[p];
            }
        }
    }
    return newo;
}

function unique(list){
    var r = {}, temp = list.slice();
    for (var i = 0, v, l = temp.length; i < l; i++) {
        v = temp[i];
        if (!r[v]) {
            r[v] = true;
            list.push(v);
        }
    }
    list.splice(0, temp.length);
    return list;
}

function mkdir_p(dirPath, mode, callback) {
    fs.mkdir(dirPath, mode, function(err) {
        if (err && err.errno === 34) {
            return mkdir_p(path.dirname(dirPath), mode, function(){
                mkdir_p(dirPath, mode, callback);
            });
        }
        if (callback) {
            callback(err);
        }
    });
}

function writeFile3721(target, content, callback){

    fs.writeFile(target, content, function(err){
        if (err && err.errno === 34) {
            return mkdir_p(path.dirname(target), 0777, function(){
                writeFile3721(target, content, callback);
            });
        }
        if (callback) {
            callback(err);
        }
    });
}

function disable_methods(obj, cfg){
    cfg = cfg || obj;
    for (var i in cfg) {
        obj[i] = function(){};
    }
}

optimist.usage('Autobuild tool for OzJS based WebApp.\n'
    + 'Usage: $0 [build script] --config [configuration file]')
        .alias('s', 'silent')
        .alias('c', 'config')
        .boolean('jam')
        .boolean('silent')
        .boolean('enable-modulelog');

exports.ozma = exports.Ozma = ozma;

exports.exec = function(){
    ozma().exec(optimist.alias().argv);
};

if (!module.parent) {
    exports.exec();
}
