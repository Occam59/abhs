'use strict';

var now;

function ping() {
    now = Date.now();
    pingOnce(100);
}

function pingOnce(i) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", window.location + "ping");
    xhr.send();
    xhr.responseType = "json";
    xhr.onload = () => {
        i--;
        if(i) {
            pingOnce(i);
        } else {
            let tag = document.createElement("p");
            var text = document.createTextNode(`100 pings in ${Date.now()-now}ms`);
            tag.appendChild(text);
            var element = document.getElementById("buttons");
            element.appendChild(tag);
        }
    };        
}