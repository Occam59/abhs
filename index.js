'use strict';

import _ from 'lodash';
import { Autoblow } from "@xsense/autoblow-sdk";
import * as fs from 'fs';
import * as net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import ejs from 'ejs';
import { networkInterfaces } from 'os';
import got from 'got';


const port = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nullTimeStamp = {
    path: '',
    duration: 0,
    currentTime: 0,
    playbackSpeed: 1,
    playerState: -11
  };

var lastTimeStamp = nullTimeStamp;

var isConnectedAutoblow = false;
var isConnectedHereSphere = false;
var isABBusy = false;
var currentScript = '';
var noScriptHandled = false;
var message = '';
var log = [];

var responseTimes = {
    start: [0,0],
    stop: [0,0],
    state: [0,0]
};

/*
  reads filename and parses JSON
*/
function readJSONFile(filename) {
    return JSON.parse(fs.readFileSync(filename));
}


/*
    Set express and routes
*/
const app = express();
app.set('port', process.env.PORT || port); // set express to use this port
app.set('views', __dirname + '/views'); // set express to look in this folder to render our view
app.set('view engine', 'ejs'); // configure template engine
app.use(express.static(path.join(__dirname, 'public'), { redirect:false, index: false })); // configure express to use public folder
app.get('/', displayPage);
app.get('/connectHereSphere', connectHereSphere);
app.get('/connectAutoblow', connectAutoblow);
app.get('/disconnectAutoblow', disconnectAutoblow);
app.get('/setOffset/:offset', setOffset);
app.get('/ping', ping);


const client = new net.Socket();
const autoblow = new Autoblow();
const config = readJSONFile('./config.json', 'utf-8');

const goti = got.extend( { 
    prefixUrl: config.xbvr_url, 
    responseType: 'json', 
    resolveBodyOnly: true, 	
    timeout: {
        request: 60000
    }
});

async function ping(req, res) {
    return res.json({});
}
/*
    Displays the web page to connect/disconnect and set offsets
*/
async function displayPage(req, res, state = null) {
    if((!state || typeof state != 'object') && isConnectedAutoblow) {
        try {
            let now = Date.now();
            state = await autoblow.getState();
            responseTimes.state[0]++;
            responseTimes.state[1] += Date.now()-now;
        } catch(e) {
            logger('Caught error getting state: ', e); 
            isConnectedAutoblow = false; 
            lastTimeStamp = nullTimeStamp;
        }
    }

    let data = {
        isConnectedAutoblow: isConnectedAutoblow,
        isConnectedHereSphere: isConnectedHereSphere,
        offset: config.offset,
        message: message,
        state: state,
        log: log,
        responseTimes: responseTimes
    };
    let html = await ejs.renderFile('views/abhs.ejs', data, { async: true });
    message = '';
    return res.send(html);

}

/*
    Route for setting the offset
*/
async function setOffset(req, res) {
    config.offset = parseInt(req.params.offset);
    message = 'Offset updated';
    return displayPage(req, res);
}

/*
    Route for connecting to the Autoblow device
*/
async function connectAutoblow(req, res) {
    let state = await connectAB();
    return displayPage(req, res, state);
}

/*
    Route for disconnecting from the Autoblow device. Tries to stop the device first.
*/
async function disconnectAutoblow(req, res) {
    let state = await stopAutoblow(lastTimeStamp, true);
    isConnectedAutoblow = false;
    lastTimeStamp = nullTimeStamp;
    return displayPage(req, res, state);
}

/*
    Rounte for HereSphere timespamp server connection
*/
async function connectHereSphere(req, res) {
    await processHereSphereConnection().catch((e) => logger('Error:', e));
    return displayPage(req, res);
}

/*
    Connects to HereSpere timestamp server and handles messages. Messages are converted to JSON. They are ignored if the device is not connected or we are already 
    processing a message. Possibilities are new video, new state or new time. Position reset if difference bwteen times > 0.1s.
*/
async function processHereSphereConnection() {

    return new Promise((resolve, reject) => {

        function connectListener() {
            message = 'Connected to HereSphere';
            logger(message);
            isConnectedHereSphere = true;
            client.on('data', dataListener);
            return resolve();
        }
            
        function errorListener(error) {
            logger('Error: ', error.code);
            message = error.code + ': Is the HereSphere serve running?';
            logger(message);
            return reject('Connection refused');
        }

        async function dataListener(data) {
            let timeStamp = JSON.parse(data.toString('utf-8', 4));
            // logger('Timestamp:', JSON.stringify(timeStamp));
            if (isABBusy || !isConnectedAutoblow) return;
            isABBusy = true;
            if (timeStamp.path != lastTimeStamp.path) {
                // if(!noScriptHandled) 
                logger('New video: ', timeStamp.path, true);
                changeVideo(timeStamp);
            } else if (timeStamp.playerState != lastTimeStamp.playerState) {
                logger('New state: ', timeStamp.playerState ? 'Paused' : 'Playing', true);
                changeState(timeStamp);
            } else if (Math.abs(timeStamp.currentTime - lastTimeStamp.currentTime - config.update_interval) > 0.1 && timeStamp.playerState == 0) {
                logger('New time: ', timeStamp.currentTime, true);
                changeTime(timeStamp);
            } else if (!lastTimeStamp || timeStamp.playbackSpeed != lastTimeStamp.playbackSpeed) {
                logger('New speed: ', timeStamp.playbackSpeed);
            }
            lastTimeStamp = timeStamp;
            isABBusy = false;
        }

        client.on('connect', connectListener);
        client.on('error', errorListener);
        
        client.on('close', function() {
            logger('Connection to HereSphere closed');
            isConnectedHereSphere = false;
            client.removeAllListeners();
        });

        client.connect(config.port, config.host);
    });        
}

/*
    Gets a funscript file and uploads it to the Autoblow device.
*/
async function changeVideo(timeStamp) {
    let funscript= await getFunscriptFilePath(timeStamp);
    let state = null;
    if(funscript) {
        noScriptHandled = false;
        logger('Loading funscript for file');
        if(!isConnectedAutoblow) return;
        try {
            state = await autoblow.syncScriptUploadFunscriptFile(funscript);
            currentScript = state.syncScriptToken
            logState(state);
            state = await changeState(timeStamp);
        } catch(e) {
            logger('Caught error loading funscript: ', e); 
            isConnectedAutoblow = false; 
        }
    } else {
        if(!noScriptHandled) {
            logger(timeStamp.path, ' has no corresponding funscript');
            state = await stopAutoblow(timeStamp);
            noScriptHandled = true;
        }
    }
}

/*
    Stops the autoblow if its playing or attempts to if the force parameter is true
*/
async function stopAutoblow(timeStamp, force = false) {
    let state = null;
    try {
        if (force || isConnectedAutoblow && !timeStamp.playerState) {
            state = await autoblow.syncScriptStop();
            logState(state);
        }
    } catch (e) {
        logger('Caught error stopping: ', e);
        isConnectedAutoblow = false;
        lastTimeStamp = nullTimeStamp;
    }
    return state;
}

/*
    Get the funscript path. Replaces the extension of the video with funscript and searches he directories provides in the config file. If no extension it assumes the file is from xbvr and searches the xbvr database.
*/
async function getFunscriptFilePath(timeStamp) {
    let filename = timeStamp.path.split('/').pop();
    let funscriptData;
    let db;
    if(/\.\w{3,5}$/.test(filename)) {
        let funscript = findFunscriptPath(filename);
        logger('Loading funscript from:', funscript);
        funscriptData = readJSONFile(funscript, 'utf8');
    } else {
        if (/^\d+ - /.test(filename)) {
            let id = filename.match(/^(\d+) /)[1];
            funscriptData = await getFunscriptFileFromXBVR(id);
        }
    }
    return funscriptData;
}

/*
    Get's funscript from XBVR
*/
async function getFunscriptFileFromXBVR(id) {
    let data = null;
    let scene = await goti.get('heresphere/' + id);
    if(scene && scene.scripts) {
        console.log('config.xbvr_url:', config.xbvr_url);
        let scripturl = scene.scripts[0].url.replace(config.xbvr_url + '/', '');
        logger('Getting funscript from:', scene.scripts[0].url);
        data = await goti.get(scripturl)
    }
    return data;
}


/*
    Search the provided paths for the funscript file
*/
function findFunscriptPath(filename) {
    let funscript;
    filename = filename.replace(/\.\w{3,9}$/, '.funscript');
    for (let dir of config.funscript_paths) {
        if (fs.existsSync(dir + '/' + filename)) {
            funscript = dir + '/' + filename;
            break;
        }
    }
    return funscript;
}

/*
    Stops or starts the Autoblow device
*/
async function changeState(timeStamp) {
    let state = null;
    if(!isConnectedAutoblow || !currentScript) return state;
    let now = Date.now();
    try {
        logger('Timestamp:', timeStamp);
        if(timeStamp.playerState) {
            state = await autoblow.syncScriptStop();
            responseTimes.stop[0]++;
            responseTimes.stop[1] += Date.now()-now;
        } else {
            state = await autoblow.syncScriptStart(Math.round(timeStamp.currentTime * 1000 + config.offset, 0));
            responseTimes.start[0]++;
            responseTimes.start[1] += Date.now()-now;
        }
        logState(state);
    } catch(e) {
        logger('Caught error changing state: ', e); 
        isConnectedAutoblow = false; 
        lastTimeStamp = nullTimeStamp;
    }
    console.log('Call duration:', Date.now()-now);
    return state;
}

/*
    Changes the Autoblow time offset.
*/
async function changeTime(timeStamp) {
    let state = null;
    if(!isConnectedAutoblow) return state;
    try {
        if(!timeStamp.playerState) {
            let state = await autoblow.syncScriptStart(Math.round(timeStamp.currentTime *1000 + config.offset, 0));
            logState(state);
        }
    } catch(e) {
        logger('Caught error changing time: ', e); 
        isConnectedAutoblow = false; 
        lastTimeStamp = nullTimeStamp;
    }
    return state;
}


/*
    Connects to the Autoblow device
*/
var isConnecting = false;
async function connectAB() {
    if(isConnectedAutoblow || isConnecting) return;
    isConnecting = true;
    currentScript = '';
    let state = null;
    try {
        logger('Connecting to device with token: ', config.device_token);
        const info = await autoblow.init(config.device_token);
        isConnectedAutoblow = true;
        logger("Connected to device:", info);
        state = await autoblow.getState();
        message = 'Connected to Autoblow device';
        logState(state);
    } catch(e) {
        logger('Caught error connecting: ', e); 
        message = 'Error connecting to Autoblow device';
        isConnectedAutoblow = false; 
        lastTimeStamp = nullTimeStamp;
    }
    isConnecting = false;
    return state;
}

/*
    Function for loging device state
*/
function logState(state) {
    let offset = state.syncScriptCurrentTime ? Math.round(state.syncScriptCurrentTime/1000) : 0 ;
    offset = Math.floor(offset/60) + ':' + (offset % 60).toString().padStart(2, '0');
    let msg = `Autoblow syncScriptToken: ${state.syncScriptToken}, operationalMode: ${state.operationalMode}, syncScriptCurrentTime: ${state.syncScriptCurrentTime} (${offset}) with offset: ${config.offset}ms`;
    logger(msg);
}

function logger(intro, msg = '', bold = false) {
    if(typeof msg == 'object') msg = JSON.stringify(msg);
    console.log(intro, msg);
    let logmsg = intro + ' ' + msg;
    if(bold) logmsg = '<b>' + logmsg + '</b>';
    log.unshift(logmsg);
}

/*
    Start the webserver
*/
async function run() {

    app.listen(port, () => {
        let nets = _.flatten(_.map(_.toPairs(networkInterfaces()), el => el[1]));
        nets = _.find(nets, { family: 'IPv4', internal: false });
        console.log(`Server running on address (guess): ${nets.address} port: ${port}`);
    });
}

run();
