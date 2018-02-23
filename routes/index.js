var express = require('express');
var router = express.Router();
var app = require('../app.js');
var databox = require('node-databox');
var moment = require('moment');
var FitbitApiClient = require('fitbit-node');


var AUTH_REDIRECT_URL = "/#!/databox-driver-fitbithr/ui";

const client = new FitbitApiClient({
    clientId: "YOUR_CLIENT_ID",
    clientSecret: "YOUR_CLIENT_SECRET",
    apiVersion: '1.2'
});

const DATABOX_ZMQ_ENDPOINT = process.env.DATABOX_ZMQ_ENDPOINT;


var kvc = databox.NewKeyValueClient(DATABOX_ZMQ_ENDPOINT, false);
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
movesPlacesSource.Description = 'Fitbithr monthly hr data';
movesPlacesSource.ContentType = 'application/json';
movesPlacesSource.Vendor = 'psyao1';
movesPlacesSource.DataSourceType = 'fitbitHr';
movesPlacesSource.DataSourceID = 'fitbitHr';
movesPlacesSource.StoreType = 'kv';

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
    kvc.Read('fitbitToken')
        .then((storedRes) => {
            console.log("Verify: Token found: " + storedRes.access_token);
            console.log("Verify: Refresh Token found: " + storedRes.refresh_token);
            refreshAccessToken(storedRes.access_token, storedRes.refresh_token)
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


/** Stores the current Client ID/Client Secret for the Moves Application */
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
    kvc.Read('fitbitCredentials').then((res) => {
        console.log("Credentials found: " + res);
        resolve(res);
    }).catch((err) => {
        console.log("No credentials found: " + err);
        reject(null);
    });
});


/** Driver home, will display data with a valid access token or begin authentication if necessary */
router.get('/', function(req, res, next) {
    verifyAccessToken.then((token) => {
            // Get latest data..
            res.render('settings', {
                "title": "Fitbit HR Driver",
                "profile": movesProfile,
                "syncStatus": syncStatus,
                "places": places
            });
        })
        .catch((tokenError) => {
            // We do not have a valid token, begin auth process
            console.log(tokenError);
            // Prompt for ID/Secret
            res.render('index', {
                "title": "Fitbit HR Driver"
            });
        });
});

/** Auth route, will create an auth code and redirect to /authtoken, where a token is created and stored */
router.post('/auth', function(req, res, next) {
    client.clientId = req.body.clientId;
    client.clientId = req.body.clientSecret;
    storeAppCredentials(client.clientId, client.clientId)
        .then((storeRes) => {
            let callbackUrl = "https://localhost/databox-driver-fitbithr/ui/authtoken";
            let url = client.getAuthorizeUrl('activity heartrate location nutrition profile settings sleep social weight', callbackUrl);
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
        let token = result.access_token;
        let url = "https://localhost/databox-driver-fitbithr/ui/";
        storeToken(token)
        .then((storeRes) => {
            res.end('<html><body><p>Redirecting...</p><script>parent.location="' + url + '"</script></body></html>');
        })
        .catch((storeErr) => {
            res.end('<html><body><p>Redirecting...</p><script>parent.location="' + url + '"</script></body></html>');
        });
    }).catch(err => {
        res.status(err.status).send(err);
    });
});


module.exports = router;