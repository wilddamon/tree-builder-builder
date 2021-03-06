var fs = require('fs');
var zlib = require('zlib');
var StringDecoder = require('string_decoder').StringDecoder;

var TreeBuilder = require('../lib/tree-builder');
var types = require('./types.js');

var EjsFabricator = require('../lib/ejs-fabricator');
var TraceFilter = require('../lib/trace-filter');
var TraceTree = require('../lib/trace-tree');
var TracePrettyPrint = require('../lib/trace-pretty-print');
var TracePIDSplitter = require('../lib/trace-pid-splitter');
var TraceTIDSplitter = require('../lib/trace-tid-splitter');
var TraceTreeSplitter = require('../lib/trace-tree-splitter');

function writeFile(output, data, cb) {
  if (typeof data !== types.string)
    stringData = JSON.stringify(data);
  else
    stringData = data;
  fs.writeFile(output, stringData, function(err) {
    if (err)
      throw err;
    console.log('written results into \"' + output + '\".');
    // passthrough data
    cb(data);
  });
}

module.exports.writeFile = writeFile;

function gunzip(buffer, cb) {
  zlib.gunzip(buffer, function(err, data) {
    if (err) {
      cb(buffer);
      return;
    }
    gunzip(data, cb);
  });
}

function readJSONFile(filename, cb) {
  console.log('reading', filename, 'as JSON');
  fs.readFile(filename, 'utf8', function(err, data) {
    if (err)
      throw err;
    cb(JSON.parse(data));
  });
}

function readFile(filename, cb) {
  console.log('reading', filename, 'as string');
  fs.readFile(filename, 'utf8', function(err, data) {
    if (err)
      throw err;
    cb(data);
  });
}

function readFileRaw(filename, cb) {
  console.log('reading', filename, 'raw');
  fs.readFile(filename, function(err, data) {
    if (err)
      throw err;
    cb(data);
  });
}

/*
 * Pipeline Stages
 *
 * Each stage has an implementation function, 'impl'.
 * This function accepts a data object and a callback, and is responsible for
 * calling the callback with the result of processing the data.
 *
 * Each stage also provides a human-readable 'name',
 * an 'input' type, and an 'output' type.
 */

module.exports.JSONReader = function(filename) {
  return {
    impl: function(_, cb) { readJSONFile(filename, cb); },
    name: 'JSONReader: ' + filename,
    input: types.unit,
    output: types.JSON
  };
}

module.exports.reader = function(filename) {
  return {
    impl: function(_, cb) { readFileRaw(filename, cb); },
    name: 'reader: ' + filename,
    input: types.unit,
    output: types.buffer
  };
}

module.exports.fileToJSON = function() {
  return {
    impl: readJSONFile,
    name: 'fileToJSON',
    input: types.string,
    output: types.JSON
  };
}

module.exports.fileToBuffer = function() {
  return {
    impl: readFileRaw,
    name: 'fileToBuffer',
    input: types.string,
    output: types.buffer
  };
}

module.exports.gunzipAndDecode = function() {
  return {
    impl: function(data, cb) {
      gunzip(data, function(data) {
        cb(new StringDecoder('utf8').write(data));
      });
    },
    name: 'gunzipAndDecode',
    input: types.buffer,
    output: types.string
  };
}

module.exports.fileReader = function(filename) {
  return {
    impl: function(_, cb) { readFile(filename, cb); },
    name: 'fileReader: ' + filename,
    input: types.unit,
    output: types.string
  };
}

module.exports.fileToString = function() {
  return {
    impl: readFile,
    name: 'fileToString',
    input: types.string,
    output: types.string
  };
}

module.exports.filter = function(FilterType) {
  return {
    impl: treeBuilder(FilterType),
    name: 'filter: ' + FilterType.name,
    input: types.JSON,
    output: types.JSON,
  };
}

module.exports.fabricator = function(FabType, input) {
  input = input || types.JSON;
  return {
    impl: function(data, cb) {
      var fab = new FabType(data);
      cb(fab.fabricate());
    },
    name: 'fabricator: ' + FabType,
    input: input,
    output: types.JSON
  };
}

module.exports.ejsFabricator = function() {
  return {
    impl: function(data, cb) {
      cb(new EjsFabricator(data, '').fabricate());
    },
    name: 'ejsFabricator',
    input: types.string,
    output: types.Map(types.string)
  }
}

module.exports.traceFilter = function(options) {
  options = override(TraceFilter.defaults, options);
  return {
    impl: function(data, cb) {
      cb(new TraceFilter(data, options).filter());
    },
    name: 'traceFilter',
    input: types.JSON,
    output: types.JSON
  }
}

module.exports.traceTree = function() {
  return {
    impl: function(data, cb) {
      cb(new TraceTree(data).filter());
    },
    name: 'traceTree',
    input: types.JSON,
    output: types.JSON
  }
}

module.exports.traceTreeSplitter = function(options) {
  options = override(TraceTreeSplitter.defaults, options);
  return {
    impl: function(data, cb) {
      cb(new TraceTreeSplitter(data, options).filter());
    },
    name: 'traceTreeSplitter',
    input: types.JSON,
    output: types.Map(types.JSON)
  }
}

function override(defaults, options) {
  var result = {};
  for (key in defaults) {
    if (key in options)
      result[key] = options[key];
    else
      result[key] = defaults[key];
  }
  return result;
}

module.exports.tracePrettyPrint = function(options) {
  options = override(TracePrettyPrint.defaults, options);
  return {
    impl: function(data, cb) {
      cb(new TracePrettyPrint(data, options).filter());
    },
    name: 'tracePrettyPrint',
    input: types.JSON,
    output: types.string
  }
}

module.exports.tracePIDSplitter = function() {
  return {
    impl: function(data, cb) {
      cb(new TracePIDSplitter(data).split());
    },
    name: 'tracePIDSplitter',
    input: types.JSON,
    output: types.Map(types.JSON)
  };
}

module.exports.traceTIDSplitter = function() {
  return {
    impl: function(data, cb) {
      cb(new TraceTIDSplitter(data).split());
    },
    name: 'traceTIDSplitter',
    input: types.JSON,
    output: types.Map(types.JSON)
  };
}

var treeBuilder = function(WriterType) {
  return function(data, cb) {
    var writer = new WriterType();
    var builder = new TreeBuilder();
    builder.build(data);
    builder.write(writer);
    cb(writer.getHTML());
  };
};

module.exports.treeBuilderWriter = function(WriterType) {
  return {
    impl: treeBuilder(WriterType),
    name: 'treeBuilderWriter: ' + WriterType.name,
    input: types.JSON,
    output: types.string
  };
}

module.exports.fileOutput = function(filename) {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) { writeFile(filename, data, cb); },
    name: 'fileOutput: ' + filename,
    input: typeVar,
    output: typeVar
  };
}

module.exports.toFile = function() {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) { writeFile(data.left, data.right, cb); },
    name: 'toFile',
    input: types.Tuple(types.string, typeVar),
    output: typeVar
  };
}

module.exports.consoleOutput = function() {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) { console.log(data); cb(data); },
    name: 'consoleOutput',
    input: typeVar,
    output: typeVar
  };
}

module.exports.taggedConsoleOutput = function() {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) {
      for (key in data) {
        console.log(key);
        console.log('----------------'),
        console.log(data[key]);
        console.log();
      }
      cb(data);
    },
    name: 'taggedConsoleOutput',
    input: types.Map(types.string),
    output: types.Map(types.string)
  };
}

module.exports.filenames = function(options) {
  options = override({RE: ''}, options);
  return {
    impl: function(unused, cb) {
      var pieces = options.RE.split('/');
      var dir = pieces.slice(0, pieces.length - 1).join('/');
      var file = pieces[pieces.length - 1];
      var re = new RegExp('^' + file + '$');
      if (dir == '')
        var files = fs.readdirSync('.');
      else
        var files = fs.readdirSync(dir);
      cb(files.filter(re.exec.bind(re)).map(function(file) { return dir == '' ? file : dir + '/' + file; }));
    },
    name: 'filenames',
    input: types.unit,
    output: types.List(types.string)
  }
}

module.exports.input = function(options) {
  options = override({data: ''}, options);
  return {
    impl: function(unused, cb) {
      cb(options.data);
    },
    name: 'input',
    input: types.unit,
    output: types.string
  }
}

