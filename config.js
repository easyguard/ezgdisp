const defaultConfig = {
	device: "1-8:1.1",
	wan: "wan",
	lan: "lan",
	flip_screen: false,
}

const CONFIG_PATH = "/etc/config/ezgdisp.json";
const { readFileSync, writeFileSync } = require("fs");

function loadConfig() {
	try {
		return {...defaultConfig, ...JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))};
	} catch {
		writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 4));
		return defaultConfig;
	}
}

module.exports = loadConfig();