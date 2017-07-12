'use strict';

var chai = require('chai');
var moment = require('moment');
var Web3 = require('web3');
var abiDecoder = require('abi-decoder');
var assert = chai.assert;

var help = require('../LifToken/test/helpers.js');

var WTIndex = artifacts.require('../contracts/WTIndex.sol');
var WTAirline = artifacts.require('../contracts/WTAirline.sol');
var WTAirRoute = artifacts.require('../contracts/WTAirRoute.sol');
var LifToken = artifacts.require('../contracts/LifToken.sol');
var PrivateCall = artifacts.require('../contracts/PrivateCall.sol');

var augustoKey, airlineKey;

const DEBUG = true;

contract('WTAirline & WTAirRoute', function(accounts) {

  var keyIndex, wtIndex;

  beforeEach( async function() {

    // Create the WTIndex contract
    wtIndex = await WTIndex.new();

  });

  it('Should register an airline, add a route, add a flight and make a booking with private data encrypted.', async function() {

    let lifToken = await LifToken.new();

    // Simulate a crowdsale
    await help.simulateCrowdsale(lifToken, 10000, web3.toWei(0.001, 'ether'), [4000,3000,2000,1000,0], accounts);

    abiDecoder.addABI(PrivateCall._json.abi);
    abiDecoder.addABI(LifToken._json.abi);
    abiDecoder.addABI(WTAirline._json.abi);
    abiDecoder.addABI(WTIndex._json.abi);
    abiDecoder.addABI(WTAirRoute._json.abi);

    // Register airline on index
    let airlineRegisterTx = await wtIndex.registerAirline('WT Air', 'WT Test Airline', {from: accounts[2]});
    let airlineAddress = await wtIndex.getAirlineByOwner(accounts[2]);
    if (DEBUG) console.log('New WT Airline addreess:', airlineAddress[0], '\n');
    let wtAir = WTAirline.at(airlineAddress[0]);

    // Check that wtAir is indexed
    assert.equal(wtIndex.contract.address, await wtAir.index());
    assert.equal(accounts[2], await wtAir.owner());

    // Edit wtAir information and location
    let editWtAirInfoData = wtAir.contract.editInfo.getData('WT Airline', 'Winding Tree Test Airline', 'http://wtair.com');
    let editWtAirUnicationData = wtAir.contract.editLocation.getData('Madrid Street 123', 'Spain');
    await wtIndex.callAirline(0, editWtAirInfoData, {from: accounts[2]});
    await wtIndex.callAirline(0, editWtAirUnicationData, {from: accounts[2]});

    assert.equal('WT Airline', await wtAir.name());
    assert.equal('Winding Tree Test Airline', await wtAir.description());
    assert.equal('http://wtair.com', await wtAir.website());
    assert.equal('Madrid Street 123' , await wtAir.legalAddress());
    assert.equal('Spain', await wtAir.country());

    // Create a route on WT Airline
    let wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('MAD'), web3.toHex('BCN'), {from: accounts[2]});
    let addRouteData = wtAir.contract.addRoute.getData(wtRoute.address, web3.toHex('MAD'), web3.toHex('BCN'));
    await wtIndex.callAirline(0, addRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('MAD'), web3.toHex('BCN')));
    if (DEBUG) console.log('MAD -> BCN WTAir route:', wtRoute.address);
    assert.equal(wtAir.address, await wtRoute.owner());

    // Config WTAirRoute to wait for confirmation fo calls
    let changeConfigData = wtRoute.contract.changeConfirmation.getData(true);
    changeConfigData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), changeConfigData);
    await wtIndex.callAirline(0, changeConfigData, {from: accounts[2]});
    assert.equal(true, await wtRoute.waitConfirmation());

    // Add the flight on the route
    let departureTime = moment("2017-12-22 09:30").unix();
    let arrivalTime = moment("2017-12-22 11:00").unix();
    let addFlightData = wtRoute.contract.addFlight.getData(web3.toHex('101'), departureTime, arrivalTime, 100);
    let callRouteData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), addFlightData);
    await wtIndex.callAirline(0, callRouteData, {from: accounts[2]});
    let flightIndex = await wtRoute.ids.call(web3.toHex('101'));
    let flight = await wtRoute.flights.call(flightIndex);
    if (DEBUG) console.log('Flight added', flight.address);
    assert.equal(web3.toHex('101'), flight[0].substring(0,4));
    assert.equal(departureTime, parseInt(flight[1]));
    assert.equal(arrivalTime, parseInt(flight[2]));
    assert.equal(100, parseInt(flight[3]));
    assert.equal(100, parseInt(flight[4]));
    assert.equal(true, flight[5]);

    // Build the data to book a flight
    let dataToSend = {
      name: 'Augusto',
      surname: 'Lemble',
      country: 'Argentina',
      passportId: 'ARG123456'
    };

    // Encode Augusto's private data and create the data to call the public function
    let privateData = web3.toHex(JSON.stringify(dataToSend));
    let publicData = await wtRoute.contract.book.getData(web3.toHex('101'));
    if (DEBUG) console.log('Private data:', privateData);
    if (DEBUG) console.log('Public data:', publicData, '\n');

    // Augusto begin the call by ending the public bytes of the call to be executed after receivers review it
    let beginCalltx = await wtRoute.beginCall(publicData, privateData, {from: accounts[1]});
    let beginCalltxCode = web3.eth.getTransaction(beginCalltx.tx).input;
    if (DEBUG) console.log('Begin Call tx:', beginCalltx);
    if (DEBUG) console.log('Begin Call tx data:', beginCalltxCode);
    assert.equal(accounts[1], beginCalltx.logs[0].args.from);
    let pendingTxHash = beginCalltx.logs[0].args.dataHash;
    let pendingTx = await wtRoute.callsPending.call(beginCalltx.logs[0].args.dataHash);
    if (DEBUG) console.log('Call Pending:', pendingTx, '\n');
    assert.equal(false, pendingTx[2]);
    assert.equal(false, pendingTx[3]);

    // The receiver can get the privateData encrypted form the blockchian using the abi-decoder
    let beginCallDecoded = abiDecoder.decodeMethod(beginCalltxCode);
    if (DEBUG) console.log('beginCall decoded:',beginCallDecoded);
    let decryptedDataOnReceiver = web3.toAscii( beginCallDecoded.params[1].value );

    assert.equal(JSON.stringify(dataToSend), decryptedDataOnReceiver);
    if (DEBUG) console.log('Decrypted data on receiver:', decryptedDataOnReceiver);
    if (DEBUG) console.log('\n');

    // After the receiver read and verify the privateData sent by Augusto he can continue the call
    let continueCallData = await wtRoute.contract.continueCall.getData(pendingTxHash);
    continueCallData = await wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), continueCallData);
    let continueCalltx = await wtIndex.callAirline(0, continueCallData, {from: accounts[2]});
    if (DEBUG) console.log('Continue Call tx:', continueCalltx, '\n');

    // Check booking was done
    if (DEBUG) console.log('Flight booked: ', continueCalltx.receipt.logs[0].data.substring(0,4).toString('utf8'));
    assert.equal(web3.toHex('101'), continueCalltx.receipt.logs[0].data.substring(0,4));
    let flightBooked = await wtRoute.flights.call(flightIndex);
    if (DEBUG) console.log('Flight booked', flightBooked, '\n');
    assert.equal(web3.toHex('101'), flightBooked[0].substring(0,4));
    assert.equal(departureTime, parseInt(flightBooked[1]));
    assert.equal(arrivalTime, parseInt(flightBooked[2]));
    assert.equal(99, parseInt(flightBooked[3]));
    assert.equal(100, parseInt(flightBooked[4]));
    assert.equal(true, flightBooked[5]);

    // Check pendingTx was confirmed
    let pendingTxConfirmed = await wtRoute.callsPending.call(beginCalltx.logs[0].args.dataHash);
    if (DEBUG) console.log('Call Pending confirmed:', pendingTxConfirmed, '\n');
    assert.equal(true, pendingTxConfirmed[2]);
    assert.equal(true, pendingTxConfirmed[3]);
  });

  it('Should register an airline, add, remove and edit routes.', async function() {

    // Register airline on index
    let airlineRegisterTx = await wtIndex.registerAirline('WT Air', 'WT Test Airline', {from: accounts[2]});
    let airlineAddress = await wtIndex.getAirlineByOwner(accounts[2]);
    if (DEBUG) console.log('New WT Airline addreess:', airlineAddress[0], '\n');
    let wtAir = WTAirline.at(airlineAddress[0]);

    // Check that wtAir is indexed
    assert.equal(wtIndex.contract.address, await wtAir.index());
    assert.equal(accounts[2], await wtAir.owner());

    // Create a first route
    let wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('MAD'), web3.toHex('BCN'), {from: accounts[2]});
    let addRouteData = wtAir.contract.addRoute.getData(wtRoute.address, web3.toHex('MAD'), web3.toHex('BCN'));
    await wtIndex.callAirline(0, addRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('MAD'), web3.toHex('BCN')));
    if (DEBUG) console.log('MAD -> BCN WTAir route:', wtRoute.address);
    assert.equal(wtAir.address, await wtRoute.owner());

    // Create a second route
    wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('BCN'), web3.toHex('MAD'), {from: accounts[2]});
    addRouteData = wtAir.contract.addRoute.getData(wtRoute.address, web3.toHex('BCN'), web3.toHex('MAD'));
    await wtIndex.callAirline(0, addRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('BCN'), web3.toHex('MAD')));
    if (DEBUG) console.log('BCN -> MAD WTAir route:', wtRoute.address);
    assert.equal(wtAir.address, await wtRoute.owner());

    // Create a third route
    wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('BCN'), web3.toHex('GDC'), {from: accounts[2]});
    addRouteData = wtAir.contract.addRoute.getData(wtRoute.address, web3.toHex('BCN'), web3.toHex('GDC'));
    await wtIndex.callAirline(0, addRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('BCN'), web3.toHex('GDC')));
    if (DEBUG) console.log('BCN -> GDC WTAir route:', wtRoute.address);
    assert.equal(wtAir.address, await wtRoute.owner());

    // Create a fourth route
    wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('GDC'), web3.toHex('BCN'), {from: accounts[2]});
    addRouteData = wtAir.contract.addRoute.getData(wtRoute.address, web3.toHex('GDC'), web3.toHex('BCN'));
    await wtIndex.callAirline(0, addRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('GDC'), web3.toHex('BCN')));
    if (DEBUG) console.log('GDC -> BCN WTAir route:', wtRoute.address);
    assert.equal(wtAir.address, await wtRoute.owner());

    // Change routes address
    wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('BCN'), web3.toHex('MAD'), {from: accounts[2]});
    let changeRouteData = wtAir.contract.changeRoute.getData(web3.toHex('BCN'), web3.toHex('MAD'), wtRoute.address);
    await wtIndex.callAirline(0, changeRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('BCN'), web3.toHex('MAD')));

    wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('BCN'), web3.toHex('MAD'), {from: accounts[2]});
    changeRouteData = wtAir.contract.changeRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), wtRoute.address);
    await wtIndex.callAirline(0, changeRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('MAD'), web3.toHex('BCN')));

    // Delete routes changing their address to 0x0000000000000000000000000000000000000000
    let deleteRouteData = wtAir.contract.changeRoute.getData(web3.toHex('BCN'), web3.toHex('GDC'), 0x0000000000000000000000000000000000000000);
    await wtIndex.callAirline(0, deleteRouteData, {from: accounts[2]});
    assert.equal('0x0000000000000000000000000000000000000000', await wtAir.getRoute(web3.toHex('BCN'), web3.toHex('GDC')));

    deleteRouteData = wtAir.contract.changeRoute.getData(web3.toHex('GDC'), web3.toHex('BCN'), 0x0000000000000000000000000000000000000000);
    await wtIndex.callAirline(0, deleteRouteData, {from: accounts[2]});
    assert.equal('0x0000000000000000000000000000000000000000', await wtAir.getRoute(web3.toHex('GDC'), web3.toHex('BCN')));

  });

  it('Should register an airline, add a route, add, edit and remove flights.', async function() {

    // Register airline on index
    let airlineRegisterTx = await wtIndex.registerAirline('WT Air', 'WT Test Airline', {from: accounts[2]});
    let airlineAddress = await wtIndex.getAirlineByOwner(accounts[2]);
    if (DEBUG) console.log('New WT Airline addreess:', airlineAddress[0], '\n');
    let wtAir = WTAirline.at(airlineAddress[0]);

    // Check that wtAir is indexed
    assert.equal(wtIndex.contract.address, await wtAir.index());
    assert.equal(accounts[2], await wtAir.owner());

    // Create the route
    let wtRoute = await WTAirRoute.new(wtAir.address, web3.toHex('MAD'), web3.toHex('BCN'), {from: accounts[2]});
    let addRouteData = wtAir.contract.addRoute.getData(wtRoute.address, web3.toHex('MAD'), web3.toHex('BCN'));
    await wtIndex.callAirline(0, addRouteData, {from: accounts[2]});
    assert.equal(wtRoute.address, await wtAir.getRoute(web3.toHex('MAD'), web3.toHex('BCN')));
    if (DEBUG) console.log('MAD -> BCN WTAir route:', wtRoute.address);
    assert.equal(wtAir.address, await wtRoute.owner());

    // Add the first flight on the route
    let departureTime = moment("2017-12-22 09:30").unix();
    let arrivalTime = moment("2017-12-22 11:00").unix();
    let addFlightData = wtRoute.contract.addFlight.getData(web3.toHex('101'), departureTime, arrivalTime, 100);
    let callRouteData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), addFlightData);
    await wtIndex.callAirline(0, callRouteData, {from: accounts[2]});
    let flightIndex = await wtRoute.ids.call(web3.toHex('101'));
    let flight = await wtRoute.flights.call(flightIndex);
    if (DEBUG) console.log('Flight added', flight[0].substring(0,4));
    assert.equal(web3.toHex('101'), flight[0].substring(0,4));
    assert.equal(departureTime, parseInt(flight[1]));
    assert.equal(arrivalTime, parseInt(flight[2]));
    assert.equal(100, parseInt(flight[3]));
    assert.equal(100, parseInt(flight[4]));
    assert.equal(true, flight[5]);

    // Add the second flight on the route
    departureTime = moment("2017-12-22 12:00").unix();
    arrivalTime = moment("2017-12-22 13:30").unix();
    addFlightData = wtRoute.contract.addFlight.getData(web3.toHex('102'), departureTime, arrivalTime, 100);
    callRouteData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), addFlightData);
    await wtIndex.callAirline(0, callRouteData, {from: accounts[2]});
    flightIndex = await wtRoute.ids.call(web3.toHex('102'));
    flight = await wtRoute.flights.call(flightIndex);
    if (DEBUG) console.log('Flight added', flight[0].substring(0,4));
    assert.equal(web3.toHex('102'), flight[0].substring(0,4));
    assert.equal(departureTime, parseInt(flight[1]));
    assert.equal(arrivalTime, parseInt(flight[2]));
    assert.equal(100, parseInt(flight[3]));
    assert.equal(100, parseInt(flight[4]));
    assert.equal(true, flight[5]);

    // Add the third flight on the route
    departureTime = moment("2017-12-22 15:00").unix();
    arrivalTime = moment("2017-12-22 16:30").unix();
    addFlightData = wtRoute.contract.addFlight.getData(web3.toHex('103'), departureTime, arrivalTime, 100);
    callRouteData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), addFlightData);
    await wtIndex.callAirline(0, callRouteData, {from: accounts[2]});
    flightIndex = await wtRoute.ids.call(web3.toHex('103'));
    flight = await wtRoute.flights.call(flightIndex);
    if (DEBUG) console.log('Flight added', flight[0].substring(0,4));
    assert.equal(web3.toHex('103'), flight[0].substring(0,4));
    assert.equal(departureTime, parseInt(flight[1]));
    assert.equal(arrivalTime, parseInt(flight[2]));
    assert.equal(100, parseInt(flight[3]));
    assert.equal(100, parseInt(flight[4]));
    assert.equal(true, flight[5]);

    // Add the fourth flight on the route
    departureTime = moment("2017-12-22 18:00").unix();
    arrivalTime = moment("2017-12-22 19:30").unix();
    addFlightData = wtRoute.contract.addFlight.getData(web3.toHex('104'), departureTime, arrivalTime, 100);
    callRouteData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), addFlightData);
    await wtIndex.callAirline(0, callRouteData, {from: accounts[2]});
    flightIndex = await wtRoute.ids.call(web3.toHex('104'));
    flight = await wtRoute.flights.call(flightIndex);
    if (DEBUG) console.log('Flight added', flight[0].substring(0,4));
    assert.equal(web3.toHex('104'), flight[0].substring(0,4));
    assert.equal(departureTime, parseInt(flight[1]));
    assert.equal(arrivalTime, parseInt(flight[2]));
    assert.equal(100, parseInt(flight[3]));
    assert.equal(100, parseInt(flight[4]));
    assert.equal(true, flight[5]);

    // Delete a flight
    let removeFlightData = wtRoute.contract.removeFlight.getData(web3.toHex('103'));
    callRouteData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), removeFlightData);
    await wtIndex.callAirline(0, callRouteData, {from: accounts[2]});
    if (DEBUG) console.log('Flight deleted');
    assert.equal(0, parseInt(await wtRoute.ids.call(web3.toHex('103'))));
    flight = await wtRoute.flights.call(3);
    assert.equal('0x000000000000000000000000', flight[0]);
    assert.equal(0, parseInt(flight[1]));
    assert.equal(0, parseInt(flight[2]));
    assert.equal(0, parseInt(flight[3]));
    assert.equal(0, parseInt(flight[4]));
    assert.equal(false, flight[5]);

    // Edit a flight
    departureTime = moment("2017-12-22 12:30").unix();
    arrivalTime = moment("2017-12-22 14:00").unix();
    let editFlightData = wtRoute.contract.editFlight.getData(web3.toHex('102'), departureTime, arrivalTime);
    callRouteData = wtAir.contract.callRoute.getData(web3.toHex('MAD'), web3.toHex('BCN'), editFlightData);
    await wtIndex.callAirline(0, callRouteData, {from: accounts[2]});
    flightIndex = await wtRoute.ids.call(web3.toHex('102'));
    flight = await wtRoute.flights.call(flightIndex);
    if (DEBUG) console.log('Flight edited', flight[0].substring(0,4));
    assert.equal(web3.toHex('102'), flight[0].substring(0,4));
    assert.equal(departureTime, parseInt(flight[1]));
    assert.equal(arrivalTime, parseInt(flight[2]));
    assert.equal(100, parseInt(flight[3]));
    assert.equal(100, parseInt(flight[4]));
    assert.equal(true, flight[5]);

  });

});