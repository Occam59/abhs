# HereSphere Autoblow Funscript Server

A server to play and control funscripts on an Autoblow AI Ultra from HereSphere playing local files through the HereSphere timestamp server.

Will work with XBVR and SMB. Because the timestamp server only gives filenames, funscript locations must be provided in the config file. 

Not officially endorsed by or affiliated with HereSphere or Autoblow.

# Installation

Have nodejs and npm installed.

Download the code. Run npm install. 

# User Guide

## Step 1 - Set up the Timestamp Server in HereSphere

Start HereSphere and go to User Settings. Enable the timestamp server and get the IP address and port.

## Step 2 - Set up the HAFS Config file

Set the following parameters in the config.json file.

    "host": "xxx.xxx.xxx.xxx",  the ip address from the HereSphere Timestamp server
    "port": yyyyy,  the port from the HereSphere Timestamp server
    "update_interval": 1.0,   the update interval from the HereSphere Timestamp server
    "device_token": "zzzzzzzzz", the Autoblow AI Ultra device token
    "offset": 300, an offset for the time from a message to an Autoblow start command
    "funscript_paths": ["...."], an array of paths where funscripts are stored required because the timestamp server only gives filenames or xbvr ids and title
    "xbvr_url": "...", url to connect to your xbvr server

## Step 3 - Start the server

Set your desired port in the environment

"node index" to run.

## Step 4 - Using the HAFS

Start HereSphere. Connect to the machine and port for the server in the browser.

Click on Connect Autoblow. 

Click on Connect HereSphere. You may need to toggle the timestamp server from user settings if you have a problem connecting.

You can change the offset of the start commands temporarily from that in the config file by changing the input and clicking "Set Offset". Note there is also an offset you can use in HereSphere.

Refresh will reload the page showing the state of the Autoblow device and logs.

Ping server will return the time for 100 pings to the abhs server. In principle the offset should be somewhere near half the average of these calls (time from headset to server) plus the average of the start response times minus half the average of the state/stop call response times (time from server to starting Autoblow).

If active you will see the latest statee from the Autoblow device.

The logs will show what commands are executed.

## Step 5 - Enjoy your video

Start your video from either SMB or xbvr and enjoy.

