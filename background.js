var currentSite = null;
var currentTabId = null;
var startTime = null;

var updateTimeOnPageInterval = 1000 * 10;  // 10 seconds // 1 minute.

chrome.alarms.onAlarm.addListener(function( alarm ) {
  if(localStorage['automaticDonate'] == "true"){
    var val = '',
        address = '',
        SATOSHIS = 100000000,
        FEE = SATOSHIS * .0001,
        BTCUnits = 'BTC',
        BTCMultiplier = SATOSHIS;

    Promise.all([
      preferences.setCurrency(localStorage['fiatCurrencyCode']),
      wallet.restoreAddress()
    ]).then(function(){
      paymentManager.payAll();
      localStorage['weeklyAlarmReminder'] = false;
      chrome.tabs.getSelected(null, function(tab) {
        chrome.browserAction.setBadgeBackgroundColor({color:'#000000', tabId: tab.id});
        chrome.browserAction.setBadgeText({text: 'Sent!', tabId: tab.id});
      });
    });
  } else if (localStorage['manualRemind'] == 'true') {
    localStorage['weeklyAlarmReminder'] = true;
    chrome.tabs.getSelected(null, function(tab) {
      chrome.browserAction.setBadgeBackgroundColor({color:'#FF9D05'});
      chrome.browserAction.setBadgeText({text: '....$'});
    });
  }

});

// http://stackoverflow.com/questions/4945541/dynamically-deploying-content-scripts-in-chrome-extensions
// chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
//     if(changeInfo.status == "complete" && isInUserList(tab.url)) {
//         chrome.tabs.executeScript(tabId, {file:"script.js"}, function() {
//             //script injected
//         });
//     }
// });


function checkIdleTime(newState) {
  console.log("Checking idle behaviour " + newState);
  if ((newState == "idle" || newState == "locked") &&
      localStorage["paused"] == "false") {
    localStorage["paused"] = "true";
  } else if (newState == "active") {
    localStorage["paused"] = "false";
  }
}

function updateTimeOnPage() {
  if (localStorage["paused"] == "true") {
    currentSite = null;
    return;
  }

  if (currentTabId == null) {
    return;
  }

  chrome.tabs.get(currentTabId, function(tab) {
    // Ensure set on focused window.
    chrome.windows.get(tab.windowId, function(window) {
      if (!window.focused) {
        return;
      }
      var site = tab.url
      if (site == null) {
        return; // console.log("Not valid URL.");
      }

      // Init on browser or tab startup.
      if (currentSite == null) {
        currentSite = site;
        startTime = new Date();
        return;
      }

      // Compare the current time to last time.
      var now = new Date();
      var delta = now.getTime() - startTime.getTime();

      // If delta is too large. Something unexpected has happened, just ignore.
      if (delta < (updateTimeOnPageInterval + updateTimeOnPageInterval / 2)) {
        isBlacklisted(site, function(blacklistFound){
          if(!blacklistFound){ // not blacklisted.
            updateTime(currentSite, delta/1000);
          }
        });
      }

      // When tab change, the site might also change.
      currentSite = site;
      startTime = now;
    });
  });
}

function isBlacklisted(url, callback){
  hostname = new URL(url).hostname;
  db.get('blacklistedhostnames', hostname).then(function(record){
    if(!record){ // if hostname not blacklisted.
      db.get('blacklist', url).then(function(record){
        if(!record){
          callback(false);
        } else {
          callback(true);
        }
      });
    } else {
      callback(true);
    }
  });
}

function hasKnownBtcAddress(url, callback){
  db.get('sites', url).then(function(record){
      if(record){
          callback(record);
      } else {
          callback(false);
      }
  });
}



function isStarredUser(url, callback){
  twitterHandle = url.match(/[https|http]:\/\/twitter\.com\/(.*)/);
  if(twitterHandle){
    twitterHandle = twitterHandle[1];
    db.get('sponsors', twitterHandle).then(function(record){
      if(record){
          callback(true);
      } else {
          callback(false);
      }
    });
  } else {
    callback(false);
  }
}


function updateTime(url, seconds) {  //function updateTime(site, seconds) {

  // Only sites with BitcoinAddresses should exist.
  // No need to record sites that don't have a bitcoinAddress
  db.get('sites', url).done(function(record) {
    if (record && record.timeOnPage) { // exist
      db.from('sites', '=', url).patch({timeOnPage: (parseInt(record.timeOnPage) + parseInt(seconds))});
    } else if(record) {
      db.from('sites', '=', url).patch({timeOnPage: parseInt(seconds)});
    }
  });
}


Array.prototype.diff = function(a) {
  // [1,2,3,4,5,6].diff( [3,4,5] );
  // => [1, 2, 6]
  return this.filter(function(i) {return a.indexOf(i) < 0;});
};

function initialize() {
  db = new ydn.db.Storage('protip', schema);

  if(localStorage.firstRun) {
    db.put('subscriptions', {label: 'Support ProTip', amountFiat: '0.25'}, '13U4gmroMmFwHAwd2Sukn4fE2WvHG6hP8e');
    localStorage.firstRun = false
  }

  if (!localStorage.paused) {
    localStorage.paused = "false";
  }


  chrome.tabs.onSelectionChanged.addListener(
  function(tabId, selectionInfo) {
    console.log("Tab changed");
    currentTabId = tabId;
    updateTimeOnPage();
  });

  chrome.tabs.onUpdated.addListener(
  function(tabId, changeInfo, tab) {
    if (tabId == currentTabId) {
      console.log("Tab updated");
      updateTimeOnPage();
    }
  });

  chrome.windows.onFocusChanged.addListener(
  function(windowId) {
    console.log("Detected window focus changed.");
    chrome.tabs.getSelected(windowId,
    function(tab) {
      console.log("Window/Tab changed");
      currentTabId = tab.id;
      updateTimeOnPage();
    });
  });


  // Force an update of the counter
  window.setInterval(updateTimeOnPage, updateTimeOnPageInterval);

  // Keep track of idle time.
  chrome.idle.queryState(60, checkIdleTime);
  chrome.idle.onStateChanged.addListener(checkIdleTime);
}

initialize();


chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {

        if(request.action && request.action == "isBlacklisted") {
            isBlacklisted(request.url, function(blacklistFound){
                chrome.tabs.getSelected(null, function(tab) {
                    if(blacklistFound){
                        chrome.browserAction.setBadgeBackgroundColor({color:'#000000', tabId: tab.id});
                        chrome.browserAction.setBadgeText({text: 'x', tabId: tab.id});
                    } else {
                        hasKnownBtcAddress(request.url, function(record){
                            // give permission for the content script to scan the DOM for BTC addresses
                            chrome.tabs.sendRequest(tab.id, {method: 'isBlacklisted', response: false, knownBTCAddress: record.bitcoinAddress});
                        })
                    }
                });
            });
        } else if(request.action && request.action == "isStarredUser") {
            isStarredUser(request.url, function(starredFound){
                if( starredFound ) {
                    chrome.tabs.getSelected(null, function(tab) {
                        chrome.tabs.sendRequest(tab.id, {method: 'isStarredUser', response: true});
                    });
                }
            });
        } else if(request.action && request.action == "deleteBitcoinAddress"){
            db.remove('sites', request.url);
            db.put('blacklist', { url: request.url });
            chrome.tabs.getSelected(null, function(tab) {
                chrome.browserAction.setBadgeBackgroundColor({color:'#000000', tabId: tab.id});
                chrome.browserAction.setBadgeText({text: 'x', tabId: tab.id});
                chrome.browserAction.setIcon({path: './assets/images/icon_48.png', tabId: tab.id});
            });
        } else if(request.action && request.action == "putBitcoinAddress"){
            db.get('sites', request.url).done(function(record) {
                if (!record) {
                    db.put('sites', {bitcoinAddress: request.bitcoinAddress, url: request.url, title: request.title});
                } else {
                    db.from('sites', '=', record.url).patch({ bitcoinAddress: request.bitcoinAddress });
                }
                db.remove('blacklist', request.url);
            });
            chrome.tabs.getSelected(null, function(tab) {
                chrome.browserAction.setBadgeBackgroundColor({color:'#00ff00', tabId: tab.id});
                if (request.source && request.source == 'metatag') {
                    chrome.browserAction.setBadgeText({text: 'Meta', tabId: tab.id}); // request.bitcoinAddresses.length.toString(), tabId: tab.id});
                } else {
                    chrome.browserAction.setBadgeText({text: request.bitcoinAddress.substring(0,4), tabId: tab.id}); // request.bitcoinAddresses.length.toString(), tabId: tab.id});
                }
                chrome.browserAction.setIcon({path: './assets/images/icon_found_btc.png', tabId: tab.id});
            });
        }
    }
);
