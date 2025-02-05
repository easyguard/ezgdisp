const node_canvas = require("canvas");
const { readFileSync, writeFileSync } = require("fs");
const threads     = require("worker_threads");
const path = require("path");
const loadConfig = require("./config");
const config = loadConfig();
const DEVICE = config.device;
const WAN_IF = config.wan;
const LAN_IF = config.lan;

function isLANconfigured() {
	try {
		const alias = readFileSync("/sys/class/net/" + LAN_IF + "/ifalias", "utf-8").trim();
		if(alias.includes("CONFIGURED")) {
			return true;
		}
	} catch {
		return false;
	}
	return false;
}

function lcd_redraw(imageData) {
	const pixelData = new Uint16Array(imageData.data);
	if(config.flip_screen) pixelData.reverse();

	lcdThread.postMessage({ type: "redraw", pixelData}, [pixelData.buffer]);
}

function lcd_update(rect, imageData) {
	const pixelData = new Uint16Array(imageData.data);

	lcdThread.postMessage({ type: "update", rect, pixelData }, [pixelData.buffer]);
}

function lcd_orientation(portrait) {
	lcdThread.postMessage({ type: "orientation", portrait });
}

function lcd_set_time() {
	lcdThread.postMessage({ type: "heartbeat" });
}

function waitForReady() {
	return new Promise((resolve, reject) => {
		lcdThread.on("message", message => {
			if (message.complete) {
				resolve();
			}
		});
	});
}

const lcdThread = new threads.Worker("./lcd_thread.js", { workerData: { device: DEVICE, poll: 500, refresh: 1600, heartbeat: 50000 }});

const width = 320;
const height = 170;

async function showStartscreen(ctx) {
	const img = await node_canvas.loadImage("easyguard-logo.png");
	const imgWidth = 290;
	const imgHeight = 60;
	// Calculate the correct pos to center the image on the canvas
	ctx.drawImage(
		img,
		(width - imgWidth) / 2,
		(height - imgHeight) / 2
	);
}

function getNetworkStats(interfaceName) {
  const data = readFileSync('/proc/net/dev', 'utf8');
  const lines = data.split('\n');
  
  // Find the line with the given interface
  const ifaceLine = lines.find(line => line.includes(interfaceName));
  
  if (!ifaceLine) {
    throw new Error(`Interface ${interfaceName} not found`);
  }
  
  const ifaceData = ifaceLine.trim().split(/\s+/);

  return {
    rxBytes: parseInt(ifaceData[1], 10),  // total Received bytes
    txBytes: parseInt(ifaceData[9], 10),  // total Transmitted bytes
  };
}

function isInterfaceUp(interfaceName) {
  const operstatePath = path.join('/sys/class/net', interfaceName, 'operstate');
  
  try {
    const operstate = readFileSync(operstatePath, 'utf8').trim();
    
    if (operstate === 'up') {
      return true;
    } else if (operstate === 'down') {
      return false;
    } else {
      throw new Error(`Unknown state: ${operstate}`);
    }
  } catch (err) {
    console.error(`Error reading interface state for ${interfaceName}:`, err.message);
    return false;
  }
}

let lastValue = {};

// function drawNetworkStats(ctx) {
// 	ctx.fillStyle = "black";
// 	ctx.fillRect(0, 0, width, height);

// 	const interval = 5000;
// 	const stats = getNetworkStats("eth0");
// 	// calculate the rx and tx difference from the last value we got
// 	// to now across 5 seconds to get the per second value
// 	const rxSpeed = (stats.rxBytes - lastValue.rxBytes) / interval * 1000;
// 	const txSpeed = (stats.txBytes - lastValue.txBytes) / interval * 1000;
// 	lastValue = stats;

// 	// ctx.fillStyle = 'white';
// 	// ctx.font = '16px Roboto';
// 	// ctx.fillText(`RX: ${stats.rxBytes} bytes`, 10, 20);
// 	// ctx.fillText(`TX: ${stats.txBytes} bytes`, 10, 40);

// 	// We need to scale up the values to higher units to make them more readable
// 	const rxKb = rxSpeed / 1024;
// 	const txKb = txSpeed / 1024;
// 	const rxMb = rxKb / 1024;
// 	const txMb = txKb / 1024;

// 	let rx = rxMb;
// 	let tx = txMb;
// 	let unit = "MB/s";

// 	if(rxMb < 1 || txMb < 1) {
// 		rx = rxKb;
// 		tx = txKb;
// 		unit = "KB/s";
// 	}

// 	ctx.fillStyle = 'white';
// 	ctx.font = '24px Roboto';
// 	ctx.fillText(`EasyGuard`, 10, 25);
// 	ctx.fillText(`RX: ${rx.toFixed(2)} ${unit}`, 10, 70);
// 	ctx.fillText(`TX: ${tx.toFixed(2)} ${unit}`, 10, 100);

// 	ctx.fillText(`Last updated: ${new Date().toLocaleTimeString("de-de")}`, 10, 150);
// }

function network(interface) {
	const interval = 5000;
	const up = isInterfaceUp(interface);
	if(!up) {
		return {
			rx: 0,
			tx: 0,
			unit: "KB/s",
			up: false
		};
	}
	const stats = getNetworkStats(interface);
	// calculate the rx and tx difference from the last value we got
	// to now across 5 seconds to get the per second value
	if(!lastValue[interface]) {
		lastValue[interface] = {
			rxBytes: 0,
			txBytes: 0
		};
	}
	const rxSpeed = (stats.rxBytes - lastValue[interface].rxBytes) / interval * 1000;
	const txSpeed = (stats.txBytes - lastValue[interface].txBytes) / interval * 1000;
	lastValue[interface] = stats;

	// We need to scale up the values to higher units to make them more readable
	const rxKb = rxSpeed / 1024;
	const txKb = txSpeed / 1024;
	const rxMb = rxKb / 1024;
	const txMb = txKb / 1024;

	let rx = rxMb;
	let tx = txMb;
	let unit = "MB/s";

	if(rxMb < 1 || txMb < 1) {
		rx = rxKb;
		tx = txKb;
		unit = "KB/s";
	}

	return {
		rx: rx.toFixed(0),
		tx: tx.toFixed(0),
		unit,
		up: true
	};
}

const SUCCESS = "#0ab507";
const WARNING = "#dba61c";
const ERROR = "#dc1b1c";
const GRAY = "#acacac";

async function drawNetworkStats(ctx) {
	ctx.fillStyle = SUCCESS;
	ctx.fillRect(0, 0, width / 2, height);
	ctx.fillStyle = "white";
	const shield = await node_canvas.loadImage("icon/shield_success.png");
	const globe = await node_canvas.loadImage("icon/globe.png");
	const iconWidth = 512;
	const iconHeight = 512;
	// Center the image on the half of the screen
	ctx.drawImage(
		shield,
		50, 50
	);
	ctx.fillStyle = "white";
	ctx.font = "16px Roboto";
	// Center the text on the half of the screen
	let text = "Durch EasyGuard";
	let textWidth = ctx.measureText(text).width;
	ctx.fillText(
		text,
		(width / 2 - textWidth) / 2,
		height / 2 + 40
	);
	text = "abgesichert.";
	textWidth = ctx.measureText(text).width;
	ctx.fillText(
		text,
		(width / 2 - textWidth) / 2,
		height / 2 + 60
	);

	ctx.fillStyle = (isInterfaceUp(WAN_IF) && isInterfaceUp(LAN_IF)) ? SUCCESS : ERROR;
	ctx.fillRect(width / 2, 0, width / 2, height);
	ctx.fillStyle = "white";
	// Center the image on the half of the screen
	ctx.drawImage(
		globe,
		width / 2 + 50, 50
	);
	ctx.fillStyle = "white";
	ctx.font = "16px Roboto";
	const wan = network(WAN_IF);
	const lan = network(LAN_IF);

	text = wan.up ? `WAN: ${wan.rx}/${wan.tx} ${wan.unit}` : "WAN: Nicht verbunden!";
	textWidth = ctx.measureText(text).width;
	ctx.fillText(
		text,
		width / 2 + (width / 2 - textWidth) / 2,
		height / 2 + 40
	);
	text = lan.up ? `LAN: ${lan.rx}/${lan.tx} ${lan.unit}` : "LAN: Nicht verbunden!";
	textWidth = ctx.measureText(text).width;
	ctx.fillText(
		text,
		width / 2 + (width / 2 - textWidth) / 2,
		height / 2 + 60
	);

	// Center the text on the half of the screen
	// text = "RX: " + rx.toFixed(2) + " " + unit;
	// textWidth = ctx.measureText(text).width;
	// ctx.fillText(
	// 	text,
	// 	width / 2 + (width / 2 - textWidth) / 2,
	// 	height / 2 + 40
	// );
	// text = "TX: " + tx.toFixed(2) + " " + unit;
	// textWidth = ctx.measureText(text).width;
	// ctx.fillText(
	// 	text,
	// 	width / 2 + (width / 2 - textWidth) / 2,
	// 	height / 2 + 60
	// );
}

function render(ctx) {
	lcd_redraw(ctx.getImageData(0, 0, width, height));
}

(async () => {
	const canvas = node_canvas.createCanvas(width, height);
	node_canvas.registerFont("Roboto-Regular.ttf", { family: "Roboto" });
	const ctx = canvas.getContext("2d", { pixelFormat: "RGB16_565" });
	lcd_orientation(false);
	
	ctx.fillStyle = "black";
	ctx.fillRect(0, 0, width, height);
	render(ctx);
	await new Promise(resolve => setTimeout(resolve, 5000));

	await showStartscreen(ctx);
	render(ctx);

	await new Promise(resolve => setTimeout(resolve, 5000));

	// ctx.textAlign = "center";
	// ctx.fillStyle = "white";
	// ctx.font = "24px Roboto";
	// ctx.fillText("Connect over LAN", width / 2, height / 2 - 40);
	// ctx.fillText("and visit", width / 2, height / 2);
	// ctx.fillText("http://easyguard.local", width / 2, height / 2 + 40);

	// render(ctx);

	setInterval(async () => {
		if(isLANconfigured()) {
			await drawNetworkStats(ctx);
		} else {
			ctx.fillStyle = GRAY;
			ctx.fillRect(0, 0, width, height);
			ctx.fillStyle = "white";
			const shield = await node_canvas.loadImage("icon/shield_success.png");
			const iconWidth = 512;
			const iconHeight = 512;
			ctx.drawImage(shield, 50, 50);
			ctx.fillStyle = "white";
			ctx.font = "16px Roboto";
			let text = "Deaktiviert.";
			let textWidth = ctx.measureText(text).width;
			ctx.fillText(text, (width / 2 - textWidth) / 2, height / 2 + 40);
		}
		render(ctx);
	}, 5000);
})()
