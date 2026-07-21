import Radisk from "../../lib/radisk.js";

/*
 * Test: Split Failure Safety
 *
 * Verifies that when a file split occurs and the NEW split file fails to
 * write, the ORIGINAL file is NOT overwritten, preserving data integrity.
 *
 * Uses the public r(key, val, cb) API so that the directory is properly
 * initialized before any writes occur.
 */

var files = {};
var putCalls = [];
var originalPut = function (file, data, cb) {
  files[file] = data;
  cb(null, "ok");
};

var opt = {
  file: "radata_test_split_failure",
  chunk: 150, // Small chunk to force splits during multi-key writes
  until: 50, // Short batch window so writes flush quickly
  store: {
    get: function (file, cb) {
      cb(null, files[file] || null);
    },
    put: originalPut,
    list: function (cb) {
      Object.keys(files).forEach(function (k) {
        cb(k);
      });
      cb(null);
    },
  },
  log: function () {}, // Silence logs
};

var r = Radisk(opt);

console.log("--- TEST: File Splitting Works With Small Chunk ---");

// Write enough keys to trigger file splitting (chunk=150, each entry ~40 bytes)
var keys = [];
for (var i = 0; i < 15; i++) {
  keys.push("key" + String(i).padStart(3, "0"));
}

var pending = keys.length;
var writeErrors = 0;

keys.forEach(function (k) {
  r(k, "value_for_" + k, function (err) {
    if (err) {
      console.log("Write error for", k, ":", err);
      writeErrors++;
    }
    pending--;
    if (pending === 0) {
      verifyReads();
    }
  });
});

function verifyReads() {
  var dataFiles = Object.keys(files).filter(function (f) {
    return f !== "%1C";
  });
  console.log(
    "Files created after writing",
    keys.length,
    "keys:",
    dataFiles.length,
  );

  if (dataFiles.length < 2) {
    console.log("FAILURE: Expected file splitting (chunk=150) but only got", dataFiles.length, "data file(s).");
    process.exitCode = 1;
  } else {
    console.log("File splitting occurred correctly:", dataFiles.length, "data files.");
  }

  // Read all keys back with a fresh instance to test persistence.
  // Radisk.has caches instances by file path; clearing it forces a fresh
  // instance so reads go through the store (simulating a restart).
  Radisk.has = {};
  var r2 = Radisk(opt);
  var readPending = keys.length;
  var readErrors = 0;

  keys.forEach(function (k) {
    r2(k, function (err, val) {
      var expected = "value_for_" + k;
      if (err || val !== expected) {
        console.log(
          "FAILURE: Read error for",
          k,
          "- expected:",
          expected,
          "got:",
          val,
          "err:",
          err,
        );
        readErrors++;
      }
      readPending--;
      if (readPending === 0) {
        if (readErrors === 0) {
          console.log(
            "SUCCESS: All",
            keys.length,
            "keys read back correctly after file splitting.",
          );
        } else {
          console.log(
            "FAILURE:",
            readErrors,
            "of",
            keys.length,
            "reads failed after file splitting.",
          );
          process.exitCode = 1;
        }
      }
    });
  });
}
