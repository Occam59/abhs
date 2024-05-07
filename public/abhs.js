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
        if(i > 0) {
            pingOnce(i);
        } else {
            let tag = document.createElement("p");
            let time = Date.now()-now
            var text = document.createTextNode(`100 pings in ${time}ms`);
            tag.appendChild(text);
            var element = document.getElementById("buttons");
            element.appendChild(tag);
            location.href = "/setPing/" + Math.round(time/100);
        }
    };        
}