'use strict';

// The shell uses only Electron and built-in Node modules. Returning false marks
// node_modules as handled externally and prevents an empty desktop dependency
// tree from falling back to the unrelated Next application at the project root.
module.exports = async () => false;
