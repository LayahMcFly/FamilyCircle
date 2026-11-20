'use strict';
/* Preloaded (node --require) into child processes that must stay offline. Any attempt to open a network connection is recorded in the file named by NO_NET_LOG and then refused. */
const fs = require('fs'), net = require('net'), dns = require('dns'), http = require('http'), https = require('https');
const log = process.env.NO_NET_LOG;
const record = (what) => { try { fs.appendFileSync(log, what + '\n'); } catch (e) { /* nothing */ } };
const refuse = (what) => { record(what); const e = new Error('network is blocked in offline tests'); e.code = 'EOFFLINE'; throw e; };
globalThis.fetch = (...a) => refuse('fetch');
net.Socket.prototype.connect = function () { return refuse('net.connect'); };
net.connect = net.createConnection = () => refuse('net.connect');
dns.lookup = () => refuse('dns.lookup'); if (dns.promises) dns.promises.lookup = () => refuse('dns.lookup');
http.request = http.get = () => refuse('http.request'); https.request = https.get = () => refuse('https.request');
