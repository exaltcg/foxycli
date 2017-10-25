/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';
const rp = require('request-promise');
const robot = require('robotjs');
const uuidv4 =  require('uuid/v4');
const foxycmd = 'foxycmd';
const foxycmderror = 'foxycmderror';
var SpotifyConn= require('./spotify');

var logOpts = {
  logDirectory: __dirname ,
  fileNamePattern: 'foxy-<date>.log',
  dateFormat:'YYYY.MM.DD-HHa'
};

var logger = require('simple-node-logger').createRollingFileLogger(logOpts);
logger.setLevel('debug');

var gaVisitor = '';

function Parser() {
}

Parser.prototype.setMetrics = function(visitor) {
  gaVisitor = visitor;
}

const FOXY_COMMANDS = {
  'NONE': 'NONE',
  'NEXTSLIDE': 'NEXTSLIDE',
  'PREVIOUSSLIDE': 'PREVIOUSSLIDE',
  'SHUTUP': 'SHUTUP',
  'WEATHER': 'WEATHER',
  'BOOKMARK': 'BOOKMARK',
  'TIMER': 'TIMER',
  'SPOTIFY': 'SPOTIFY',
  'IOT': 'IOT',
  'POCKET': 'POCKET',
  'NPR': 'NPR',
  'GA': 'GA',
  'FEEDBACK': 'FEEDBACK'
};

const asrOptions = {
  uri: 'http://52.53.97.165/asr',
  method: 'POST',
  body: '',
  headers: {'Content-Type': 'application/octet-stream'},
  qs: {'endofspeech': 'false', 'nbest': 10}
};

const aiOptions = {
  uri: 'https://api.api.ai/api/query',
  method: 'POST',
  body: '',
  headers: {
    'Authorization': 'Bearer af2bccd942c24fd68622efc6b4c8526c',
    'Content-Type': 'application/json'
  }
};
const weatherLink = 'http://api.openweathermap.org/data/2.5/weather?' +
  'APPID=aa9502b21136daabe9a2d556938ccfbe&units=imperial&q='
const weatherOptions = {
  uri: '',
  method: 'GET',
  body: '',
  headers: {
  }
};

const shimOptions = {
  uri: 'http://localhost:3000/command',
  method: 'POST',
  body: '',
  headers: {'Content-Type': 'application/json'}
};

Parser.prototype.parseResults = function(foxyBuffer, callback) {
  asrOptions.body = foxyBuffer;
  var utterance = '';

  // Send the speech buffer to Kaldi
  rp(asrOptions)
    .then(function(body) {
      const resBody = body && body.toString('utf8');
      var jsonResults = JSON.parse(resBody);
      if (jsonResults.status != 'ok') {
        logger.debug('Kaldi failed:' + jsonResults.status);
      } 

      // Get results from Kaldi Speech rec. Format for Api.ai
      var speechBody = getAiBody(jsonResults);
      utterance = speechBody.query;
      aiOptions.body = JSON.stringify(speechBody);

      // chain to API.ai
      return rp(aiOptions);
    })
    .then(function(aiBody) {
      var payload = parseAIBody(aiBody);
      payload.utterance = utterance;
      if(payload.cmd == FOXY_COMMANDS.SPOTIFY) {
        let playlistBrowseUri = 'https://api.spotify.com/v1/browse/categories/'
          + payload.param + '/playlists';
        var spotifyCategoryPlaylistOptions = {
          uri: playlistBrowseUri,
          method: 'GET',
          headers: {'Authorization': 'Bearer ' + SpotifyConn.apiToken}
        };
        rp(spotifyCategoryPlaylistOptions)
          .then(function(body) {
            payload.param = parseSpotify(body);
            payload.utterance = cleanSpeech(payload);
            shimOptions.body = JSON.stringify(payload);
            if (payload.param == '') {
              gaVisitor.event(foxycmderror, FOXY_COMMANDS.SPOTIFY, 
                payload.utterance).send();
            } else {
              gaVisitor.event(foxycmd, payload.cmd, payload.param).send();
            }
            return rp(shimOptions);
          })
          .catch(function(err) {
            logger.debug('Spotify error:' + err);
            callback('Spotify error');
          });
      } else if (payload.cmd == FOXY_COMMANDS.IOT) {
        let iotUri = 
          'https://localhost:4443/things/zwave-efbddb01-4/properties/on';
        var iotOptions = {
          uri: iotUri,
          method: 'PUT',
          rejectUnauthorized: false,
          headers: {
            'Authorization': 'Bearer eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZ\
              CI6IjM2NDNkNjdmLTQ1MzctNGEzMS04NmIxLTgyMDk0ZGI0ODU5NCJ9.eyJpYXQi\
              OjE1MDU5MjE3NzV9.C6wKLoieTsR7ZzOqYopKPDXntxYvxY5emb4nKFqXbdE0fL1\
              D8c2DTiRJOF2i4udTrQpIdks20q_TTDLoB-uZZA',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: ''
        };
        (payload.param2 == 'on')?
          iotOptions.body = JSON.stringify({'on': true}):
          iotOptions.body = JSON.stringify({'on': false});
        gaVisitor.event(foxycmd, payload.cmd, payload.param,
          (iotOptions ? 0 : 1)).send();
          
        rp(iotOptions)
          .then(function(body) {
            logger.debug('body is:' + body);
            shimOptions.body = JSON.stringify(payload);
            payload.utterance = cleanSpeech(payload);
            shimOptions.body = JSON.stringify(payload);
            return rp(shimOptions);
          })
          .catch(function(err) {
            logger.debug('iot error is:' + err);
            gaVisitor.event(foxycmderror, payload.cmd, 
              payload.utterance).send();
            callback('iot error');
          });
      } else if (payload.cmd == FOXY_COMMANDS.WEATHER) {
        weatherOptions.uri = weatherLink + payload.param;

        rp(weatherOptions)
          .then(function(body) {
            var jsonResults = JSON.parse(body);
            payload.param = jsonResults.name;             //City name
            payload.param2 = jsonResults.main.temp;       //Current temp
            payload.param3 = jsonResults.main.temp_min;   //Min temp
            payload.param4 = jsonResults.main.temp_max;   //Max temp
            payload.param5 = jsonResults.weather[0].main; //Description
            payload.utterance = cleanSpeech(payload);
            
            gaVisitor.event(foxycmd, payload.cmd, payload.param).send();
            shimOptions.body = JSON.stringify(payload);
            
            return rp(shimOptions);
          })
          .catch(function(err) {
            logger.debug('weather error is:' + err);
            gaVisitor.event(foxycmderror, payload.cmd, 
              payload.utterance).send();
            callback('weather error');
          });
      } else if(payload.cmd == FOXY_COMMANDS.NEXTSLIDE || 
          payload.cmd == FOXY_COMMANDS.PREVIOUSSLIDE) {
        gaVisitor.event(foxycmd, payload.cmd).send();
        callback('ok');
      } else {
        payload.utterance = cleanSpeech(payload);
        shimOptions.body = JSON.stringify(payload);
        if (payload.cmd == FOXY_COMMANDS.NONE) {
          gaVisitor.event(foxycmd, payload.cmd, payload.utterance).send();
        }

        if(payload.cmd != FOXY_COMMANDS.NEXTSLIDE || 
          payload.cmd != FOXY_COMMANDS.PREVIOUSSLIDE) {
          return rp(shimOptions);
        }
      }
    })
    .then(function() {
      callback('ok');
      logger.log('debug','finished the chain');
    })
    .catch(function(err) {
      callback('error');
      gaVisitor.exception('Kaldi failed ' + err);
      logger.debug('Call failed' + err);
    });
}

function parseSpotify(body) {
  const resBody = body && body.toString('utf8');
  logger.debug('GOT DATA FROM SPOTIFY');
  var jsonResults = JSON.parse(resBody);
  let plArray = jsonResults.playlists.items;
  var playlistId = '';
  for(var i = 0; i < plArray.length; i++) {
    var obj = plArray[i];
    if (obj.type == 'playlist') {
      logger.debug('Found a playlist: ' + obj.id);
      playlistId = obj.id;
      break;
    }
  }
  return playlistId;
}

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
}

function cleanSpeech(payload) {
  var lower = payload.utterance.toLowerCase();
  var final;
  switch (payload.cmd) {
    case FOXY_COMMANDS.WEATHER:
      final = '"What\'s the weather in ' +
        payload.param + '?"';
      break;
    // TODO: add next slide
    default:
      final = '"' + lower.capitalize() + '."';
      break;
  }
  return final;
}

function parseAIBody(aiBody) {
  let jsonBody = JSON.parse(aiBody);
  var payload = {
    cmd: 'none',
    param: 'none',
    param2: 'none',
  };

  logger.debug(aiBody);
  //Determine the action from the API.AI intent parser
  switch (jsonBody.result.action) {
    case 'weather':
      logger.debug('weather is action');
      payload.cmd = FOXY_COMMANDS.WEATHER;
      payload.param = jsonBody.result.parameters['geo-city'];
      break;
    case 'timer':
      logger.debug('timer is action');
      payload.cmd = FOXY_COMMANDS.TIMER;
      payload.param = parseTimer(jsonBody.result);
      payload.param2 = jsonBody.result.parameters.any;

      gaVisitor.event(foxycmd, payload.cmd, payload.param2, 
        payload.param).send();
      
      break;
    case 'play':
      payload.cmd = FOXY_COMMANDS.SPOTIFY;
      payload.param = jsonBody.result.parameters['music-genre'];
      break;
    case 'iot':
      payload.cmd = FOXY_COMMANDS.IOT;
      payload.param = jsonBody.result.parameters.rooms;
      payload.param2 = jsonBody.result.parameters.onoff;
      break;
    case 'pocket':
      payload.cmd = FOXY_COMMANDS.POCKET;
      gaVisitor.event(foxycmd, payload.cmd, 'add').send();
      break;
    case 'nextslide':
      payload.cmd = FOXY_COMMANDS.NEXTSLIDE;
      robot.keyTap('right');
      break;
    case 'lastslide':
      payload.cmd = FOXY_COMMANDS.PREVIOUSSLIDE;
      robot.keyTap('left');
      break;
    case 'npr':
      payload.cmd = FOXY_COMMANDS.NPR;
      gaVisitor.event(foxycmd, payload.cmd).send();
      break;
    case 'feedback':
      payload.cmd = FOXY_COMMANDS.FEEDBACK;
      gaVisitor.event(foxycmd, payload.cmd).send();
      break;
    default:
      payload.cmd = FOXY_COMMANDS.NONE;
      break;
  }
  return payload;
}

function getAiBody(asrBody) {
  let conf = 0;
  let body = {
    'v':'20150910',
    'query': '',
    'lang':'en',
    'sessionId':  uuidv4(),
    'timezone':'2017-07-24T10:45:52-0400'
  };
  let text = '';
  for (var i in asrBody.data) {
    if (asrBody.data[i].confidence > conf) {
      conf = asrBody.data[i].confidence;
      text = asrBody.data[i].text;
    }
  }
  body.query = text;
  return body;
}

function parseTimer(result) {
  logger.debug('Entering parseTimer');
  var durationSecs = 0;
  if (!result.parameters.duration) {
    return durationSecs;
  }

  switch (result.parameters.duration.unit) {
    case 'min':
      durationSecs = result.parameters.duration.amount * 60;
      break;
    case 's':
      durationSecs = result.parameters.duration.amount;
      break;
    case 'h':
      durationSecs = result.parameters.duration.amount * 3600;
      break;
    case 'day':
      durationSecs = result.parameters.duration.amount * 86400;
      break;
    default:
      break;
  }

  return durationSecs;
}
module.exports = {
  Parser:Parser,
  FOXY_COMMANDS: FOXY_COMMANDS
};
