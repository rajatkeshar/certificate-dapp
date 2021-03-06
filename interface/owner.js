var DappCall = require("../utils/DappCall");
var logger = require("../utils/logger");
var locker = require("../utils/locker");
var blockWait = require("../utils/blockwait");
var util = require("../utils/util");
var constants = require("../utils/constants");
var httpCall = require('../utils/httpCall.js');
var address = require('../utils/address');
var mailCall = require("../utils/mailCall");
var belriumJS = require('belrium-js');

app.route.post("/owner/verifyViewRequest", async function(req){
    console.log("############### calling verify view request: ", req.query)

    if(!req.query.countryCode) return { message: "missing params countryCode" };
    var ownerWalletAddress = address.generateBase58CheckAddress(util.getPublicKey(req.query.secret)) + req.query.countryCode;

    var employeeCheck = await app.model.Employee.findOne({ condition: { email: req.query.email }});
    if(employeeCheck.walletAddress != ownerWalletAddress) return { message: "Invalid secret key"};

    var userDetails = await app.model.Employee.findOne({
      condition: {
          walletAddress: ownerWalletAddress
      }
    });

    if(!userDetails) { return { message: "User must be member on dapps" } }
    var issuedCert = await app.model.Issue.findOne({ condition: { transactionId: req.query.assetId} }); // transaction id in issue table is assetId
    if(!issuedCert) { return { message: "Asset does not exist" } }

    issuedCert.data = JSON.parse(issuedCert.data);
    var requester = await app.model.Requester.findOne({
        condition: { assetId: req.query.assetId, requesterWalletAddress: req.query.requesterWalletAddress }
    });

    if(requester && requester.ownerStatus.bool()) { return { message: "Request Already verified" } }

    let options = {
        fee: String(constants.fees.verifyViewRequest),
        type: 1007,
        args: JSON.stringify([req.query.requesterWalletAddress, req.query.assetId, req.query.countryCode])
    };
    let secret = req.query.secret;
    let transaction = belriumJS.dapp.createInnerTransaction(options, secret);
    let dappId = util.getDappID();
    let params = { transaction: transaction };

    console.log("registerResult data: ", params);
    var response = await httpCall.call('PUT', `/api/dapps/${dappId}/transactions/signed`, params);

    if(!response.success){
        return {
            message: JSON.stringify(response)
        }
    }

    var issuer = await app.model.Issuer.findOne({ condition: { iid: issuedCert.iid } });
    var requesterDetails = await app.model.Employee.findOne({ condition: { walletAddress: req.query.requesterWalletAddress } });
    //var owner = await app.model.Employee.findOne({ condition: { empid: issuedCert.empid } });
    var mailBody = {
        mailType: "grantCertificate",
        mailOptions: {
            requesterEmail: requesterDetails.email,
            requesterName: requesterDetails.name,
            ownerEmail: userDetails.email,
            ownerName: userDetails.name,
            issuerEmail: issuer.email,
            issuerName: issuer.name,
            certificateName: issuedCert.data.degree,
            assetId: req.query.assetId
        }
    }
    mailCall.call("POST", "", mailBody, 0);

    return response
});

app.route.post("/owner/grant/asset", async function(req){
    console.log("############### calling verify view request: ", req.query)

    if(!req.query.countryCode) return { message: "missing params countryCode" };
    var ownerWalletAddress = address.generateBase58CheckAddress(util.getPublicKey(req.query.secret)) + req.query.countryCode.toUpperCase();

    var employeeCheck = await app.model.Employee.findOne({ condition: { email: req.query.email }});
    if(employeeCheck.walletAddress != ownerWalletAddress) return { message: "Invalid secret key"};

    var userDetails = await app.model.Employee.findOne({ condition: { walletAddress: ownerWalletAddress } });
    if(!userDetails) { return { message: "Owner not found" } }

    var issuedCert = await app.model.Issue.findOne({ condition: { empid: userDetails.empid, transactionId: req.query.assetId} }); // transaction id in issue table is assetId
    if(!issuedCert) { return { message: "Asset does not exist" } }
    issuedCert.data = JSON.parse(issuedCert.data);

    var viewerDetails = await app.model.Employee.findOne({ condition: { email: req.query.viewerEmail }});
    var requesterWalletAddress = viewerDetails.walletAddress;

    var checkGranted = await app.model.Requester.findOne({ condition: { assetId: req.query.assetId, requesterWalletAddress: viewerDetails.walletAddress, ownerWalletAddress: ownerWalletAddress } });
    if(checkGranted && checkGranted.ownerStatus.bool()) { return { message: "Request Already granted" } };

    let options = {
        fee: String(constants.fees.verifyViewRequest),
        type: 1013,
        args: JSON.stringify([requesterWalletAddress, req.query.assetId, req.query.countryCode])
    };
    let secret = req.query.secret;
    let transaction = belriumJS.dapp.createInnerTransaction(options, secret);
    let dappId = util.getDappID();

    console.log("############ transaction: ", transaction);
    let params = {
        transaction: transaction
    };

    console.log("registerResult data: ", params);
    var response = await httpCall.call('PUT', `/api/dapps/${dappId}/transactions/signed`, params);

    console.log("@@@@@@@@@@@@@@@@@@@@@@@ response: ", response);
    if(!response.success) { return { message: JSON.stringify(response) } }

    var requesterDetails = await app.model.Employee.findOne({ condition: { walletAddress: req.query.requesterWalletAddress } });
    var mailBody = {
        mailType: "preGrantedCertificate",
        mailOptions: {
            grantToEmail: viewerDetails.email,
            ownerEmail: userDetails.email,
            ownerName: userDetails.name,
            certificateName: issuedCert.data.degree,
            assetId: req.query.assetId
        }
    }
    mailCall.call("POST", "", mailBody, 0);
    return response
});

app.route.post("/owner/track/assets/status", async function(req) {
  var owner = await app.model.Employee.findOne({ condition: { email: req.query.email } });
  if(!owner || owner.length == 0) { return {message: "owner not found"} }

  var issue = await app.model.Issue.findAll({ condition: { empid: owner.empid } });
  if(!issue || issue.length == 0) { return {message: "asset not found"} }

  await new Promise((resolve, reject) => {
    data = [], requesterWalletAddress = null;
    issue.map(async(obj, index) => {
      var requester = await app.model.Requester.findAll({
        condition: {
            assetId: obj.transactionId,
            ownerStatus: "false",
            issuerStatus: "false",
        }
      });

      requester.forEach((item, i) => {
        requesterWalletAddress = item.requesterWalletAddress;
        data.push(item);
      });

      if(index == issue.length-1) {
          resolve();
      }
    })
  })
  if(!data.length) {
    return {message: "no request found"};
  }
  var requesterDetails = await app.model.Employee.findOne({ condition: { walletAddress: requesterWalletAddress } });
  await new Promise((resolve, reject) => {
    data.map(async(obj, index) => {
      var issue = await app.model.Issue.findOne({ condition: { transactionId: obj.assetId } });
      var dataObj = JSON.parse(issue.data);
      var issuer = await app.model.Issuer.findOne({ condition: { iid: issue.iid } });
      data[index].certificateName = dataObj.degree;
      if(owner) {
        data[index].owner = {
          name: owner.name,
          email: owner.email,
          department: owner.department
        }
      }
      if(issuer) {
        data[index].issuer = {
          email: issuer.email,
          name: issuer.name
        }
      }
      data[index].requester = {
        email: requesterDetails.email,
        name: requesterDetails.name
      }
      if(index == data.length-1) {
          resolve();
      }
    })
  })

  return { message: "Asset list", data: data }
});

function strToBool(s) {
    // will match one and only one of the string 'true','1', or 'on' rerardless
    // of capitalization and regardless off surrounding white-space.
    //
    regex=/^\s*(true|1|on)\s*$/i

    return regex.test(s);
}

String.prototype.bool = function() {
    return strToBool(this);
};
