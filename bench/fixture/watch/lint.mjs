// A stand-in for a linter: prints two errors in the path:line:col form compilers and linters use, and fails.
console.log("roster.mjs:2:7: error: posts is missing Carrot Ironfoundersson");
console.log("roster.mjs:5:3: error: throw a WatchError, not Error");
console.log("2 errors");
process.exit(1);
