const path = require("node:path");
const tsNode = require("ts-node");

tsNode.register({
  project: path.join(__dirname, "tsconfig.test.json"),
});
