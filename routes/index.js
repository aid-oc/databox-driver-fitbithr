var express = require('express');
var router = express.Router();
var app = require('../app.js');
var databox = require('node-databox');
var moment = require('moment');
var FitbitApiClient = require('fitbit-node');


var AUTH_REDIRECT_URL = "/#!/databox-driver-fitbithr/ui";

var client = {};

const DATABOX_ZMQ_ENDPOINT = process.env.DATABOX_ZMQ_ENDPOINT;


var kvc = databox.NewKeyValueClient(DATABOX_ZMQ_ENDPOINT, false);
var credvc = databox.NewKeyValueClient(DATABOX_ZMQ_ENDPOINT, false);

let tsc = databox.NewTimeSeriesClient(DATABOX_ZMQ_ENDPOINT, false);


// Set up data stores 
// Configure Key-Value Store for Driver Settings
var driverSettings = databox.NewDataSourceMetadata();
driverSettings.Description = 'fitbithr driver settings';
driverSettings.ContentType = 'application/json';
driverSettings.Vendor = 'psyao1';
driverSettings.DataSourceType = 'fitbithrSettings';
driverSettings.DataSourceID = 'fitbithrSettings';
driverSettings.StoreType = 'kv';

// Register hr data source
var fitbitHr = databox.NewDataSourceMetadata();
fitbitHr.Description = 'Fitbithr monthly hr data';
fitbitHr.ContentType = 'application/json';
fitbitHr.Vendor = 'psyao1';
fitbitHr.DataSourceType = 'fitbitHr';
fitbitHr.DataSourceID = 'fitbitHr';
fitbitHr.StoreType = 'kv';

// Register Key-Value Store
kvc.RegisterDatasource(driverSettings)
    .then(() => {
        return kvc.RegisterDatasource(fitbitHr);
    })
    .catch((err) => {
        console.log("Error registering data source:" + err);
    });



/** Checks to see if we have an access token stored, this will then be verified and refreshed if necessary 
(saves re-inputting client details each time */
var verifyAccessToken = new Promise(function(resolve, reject) {
    let isValid = false;
    console.log("Reading fitbitToken...");
    kvc.Read('fitbitToken')
        .then((storedRes) => {
            console.log("Fitbit Token Contents: " + JSON.stringify(storedRes));
            console.log("Verify: Token found: " + storedRes.access_token);
            console.log("Verify: Refresh Token found: " + storedRes.refresh_token);
            credvc.Read('fitbitCredentials').then((credRes) => {
                    console.log("Credentials Found: " + JSON.stringify(credRes));
                    // Construct API Client
                    client = new FitbitApiClient({
                        clientId: credRes.id,
                        clientSecret: credRes.secret,
                        apiVersion: '1.2'
                    });
                    client.refreshAccessToken(storedRes.access_token, storedRes.refresh_token)
                        .then((refreshRes) => {
                            console.log("Refreshed token: " + refreshRes.access_token);
                            kvc.Write('fitbitToken', refreshRes)
                                .then((writeRes) => {
                                    console.log("Updated stored token");
                                    resolve(refreshRes);
                                })
                                .catch((writeErr) => {
                                    console.log("Error updating stored token: " + writeErr);
                                    reject(writeErr);
                                });
                        })
                        .catch((refreshErr) => {
                            console.log("Error refreshing token " + refreshErr);
                            reject(refreshErr);
                        });
                })
                .catch((credErr) => {
                    reject("No stored credentials: " + credErr);
                });
        })
        .catch((storedErr) => {
            console.log("No access token found: " + storedErr);
            reject(storedErr);
        });
});

function storeToken(token) {
    return new Promise(function(resolve, reject) {
        kvc.Write('fitbitToken', token)
            .then((res) => {
                console.log("Stored token..");
                resolve(res);
            })
            .catch((err) => {
                console.log("Failed to store token: " + err);
                reject(err);
            })
    });
};


/** Stores the current Client ID/Client Secret for the Fitbit Application */
function storeAppCredentials(clientId, clientSecret) {
    return new Promise(function(resolve, reject) {
        var fitbitCredentials = {
            id: clientId,
            secret: clientSecret
        };
        kvc.Write('fitbitCredentials', fitbitCredentials).then(() => {
            resolve();
        }).catch((err) => {
            console.log("Failed to store fitbitCredentials");
            reject(err);
        });
    });
};

/** Gets the current Client ID/Client Secret for the Fitbit Application */
var getAppCredentials = new Promise(function(resolve, reject) {
    credvc.Read('fitbitCredentials').then((res) => {
        console.log("Credentials found: " + res);
        resolve(res);
    }).catch((err) => {
        console.log("No credentials found: " + err);
        reject(null);
    });
});


/** Driver home, will display data with a valid access token or begin authentication if necessary */
router.get('/', function(req, res, next) {
    console.log("At /");
    kvc.Read('fitbitToken')
        .then((token) => {
            console.log("Got an access token: " + JSON.stringify(token));
            // Verify that the token is still valid
            // Get Fitbit Credentials, attempt a refresh
            getAppCredentials.then((credentials) => {
                    console.log("Got credentials for verification: " + JSON.stringify(credentials));
                    client = new FitbitApiClient({
                        clientId: credentials.id,
                        clientSecret: credentials.secret,
                        apiVersion: '1.2'
                    });
                    client.refreshAccessToken(token.access_token, token.refresh_token).then((newToken) => {
                            console.log("Refreshed Token: " + JSON.stringify(newToken));
                            storeToken(newToken)
                                .then((storeRes) => {
                                    console.log("(Refresh Stored Token) Downloading data...");

                                    let monthStart = moment().format("YYYY-MM-01");
                                    let now = moment();
                                    let monthData = [];
                                    // Loop over each day this month
                                    for (var m = moment(monthStart); m.diff(now, 'days') <= 0; monthStart.add(1, 'days')) {
                                        console.log("Current Iteration: " + m.format('YYYY-MM-DD'));
                                        client.get("/activities/heart/date/today/1d/1min.json", newToken.access_token).then(results => {
                                            console.log("Storing result of this iteration.." + JSON.stringify(results));
                                            let currentDate = m.format("YYYY-MM-DD");
                                            let currentObject = {
                                                date: currentDate,
                                                data: results
                                            };
                                            monthData.push(currentObject);
                                        }).catch(err => {
                                            console.log(err);
                                        });
                                    }
                                    console.log("Finished iterating this month...");
                                    kvc.Write('fitbitHr', monthData).then(() => {
                                        console.log("Stored correctly hr data");
                                    }).catch((err) => {
                                        console.log("Failed to store hr data: " + err);
                                    });
                                })
                                .catch((storeErr) => {
                                    console.log("(Refresh Invalid Token) Redirecting to /ui");
                                    res.render('index', {
                                        "title": "Fitbit HR Driver"
                                    });
                                });
                        })
                        .catch((newTokenError) => {
                            console.log("Failed to refresh token: " + newTokenError);
                            res.render('index', {
                                "title": "Fitbit HR Driver"
                            });
                        });
                })
                .catch((credentialsReadError) => {
                    console.log("Failed to read credentials: " + credentialsReadError);
                    res.render('index', {
                        "title": "Fitbit HR Driver"
                    });
                });
        })
        .catch((readError) => {
            console.log("Failed to find access token: " + readError);
            res.render('index', {
                "title": "Fitbit HR Driver"
            });
        });

    /*
    verifyAccessToken.then((token) => {
        console.log("Got token, rendering");
            // Get latest data..
            res.render('settings', {
                "title": "Fitbit HR Driver",
                "syncStatus": "synced",
            });
        })
        .catch((tokenError) => {
            console.log("verifyAccessToken failed...");
            // We do not have a valid token, begin auth process
            console.log(tokenError);
            // Prompt for ID/Secret
            res.render('index', {
                "title": "Fitbit HR Driver"
            });
        });
    */
});

/** Auth route, will create an auth code and redirect to /authtoken, where a token is created and stored */
router.post('/auth', function(req, res, next) {

    client = new FitbitApiClient({
        clientId: req.body.clientId,
        clientSecret: req.body.clientSecret,
        apiVersion: '1.2'
    });
    console.log("Got Credentials from POST: " + req.body.clientId + ", " + req.body.clientSecret);
    console.log("API Client: " + JSON.stringify(client));
    storeAppCredentials(req.body.clientId, req.body.clientSecret)
        .then((storeRes) => {
            let callbackUrl = "https://localhost/databox-driver-fitbithr/ui/authtoken";
            let url = client.getAuthorizeUrl('activity heartrate location nutrition profile settings sleep social weight', callbackUrl);
            console.log("/auth redirecting to.." + url);
            res.end('<html><body><p>Redirecting...</p><script>parent.location="' + url + '"</script></body></html>');
        })
        .catch((storeErr) => {
            console.log("Error storing credentials: " + storeErr);
        });
});

/** Request an access token using a valid authenticate code, store it and redirect back to home */
router.get('/authtoken', function(req, res, next) {
    let callbackUrl = "https://localhost/databox-driver-fitbithr/ui/authtoken";
    client.getAccessToken(req.query.code, callbackUrl).then(result => {
        let url = "https://localhost/databox-driver-fitbithr/ui/";
        console.log("Storing Token: " + JSON.stringify(result));
        let parsedToken = JSON.parse(JSON.stringify(result));
        console.log("Parsed Token: " + JSON.stringify(parsedToken));
        storeToken(parsedToken)
            .then((storeRes) => {
                console.log("(Stored Token) Redirecting to /ui");
                res.end('<html><body><p>Redirecting...</p><script>parent.location="' + url + '"</script></body></html>');
            })
            .catch((storeErr) => {
                console.log("(Invalid Token) Redirecting to /ui");
                res.end('<html><body><p>Redirecting...</p><script>parent.location="' + url + '"</script></body></html>');
            });
    }).catch(err => {
        console.log("(/authtoken) Error getting access token");
        res.status(err.status).send(err);
    });
});


module.exports = router;