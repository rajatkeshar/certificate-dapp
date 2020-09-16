var DappCall = require("../utils/DappCall");
var logger = require("../utils/logger");
var locker = require("../utils/locker");
var blockWait = require("../utils/blockwait");
var util = require("../utils/util");
var constants = require("../utils/constants");
var httpCall = require('../utils/httpCall.js');
var address = require('../utils/address');
var belriumJS = require('belrium-js');

app.route.post("/owner/verifyViewRequest", async function(req){
    console.log("############### calling verify view request: ", req.query)

    if(!req.query.countryCode) return { message: "missing params countryCode" };

    var userDetails = await app.model.Employee.findOne({
      condition: {
          walletAddress: address.generateBase58CheckAddress(util.getPublicKey(req.query.secret)) + req.query.countryCode
      }
    });

    if(!userDetails) {
      return {
          message: "User must be member on dapps"
      }
    }

    var issuedCert = await app.model.Issue.findOne({
      condition: {
          transactionId: req.query.assetId  // transaction id in issue table is assetId
      }
    });

    if(!issuedCert) {
      return {
          message: "Asset does not exist"
      }
    }

    var requester = await app.model.Requester.findOne({
        condition: {
            assetId: req.query.assetId,
            requesterWalletAddress: req.query.requesterWalletAddress
        }
    });
    console.log("################### requester: ", requester)
    if(requester && requester.ownerStatus.bool()) {
        return {
          message: "Request Already verified"
        }
    }

    console.log("constants.fees.viewRequest: ", constants.fees.verifyViewRequest);

    let options = {
        fee: String(constants.fees.verifyViewRequest),
        type: 1007,
        args: JSON.stringify([req.query.requesterWalletAddress, req.query.assetId, req.query.countryCode])
    };
    let secret = req.query.secret;

    let transaction = belriumJS.dapp.createInnerTransaction(options, secret);

    console.log("############ transaction: ", transaction);
    let dappId = util.getDappID();

    let params = {
        transaction: transaction
    };

    console.log("registerResult data: ", params);
    var response = await httpCall.call('PUT', `/api/dapps/${dappId}/transactions/signed`, params);

    console.log("@@@@@@@@@@@@@@@@@@@@@@@ response: ", response);
    if(!response.success){
        return {
            message: JSON.stringify(response)
        }
    }

    //await blockWait();

    return response
});

app.route.post("/owner/track/assets/status", async function(req) {
  var owner = await app.model.Employee.findOne({
    condition: { email: req.query.email }
  });
  if(!owner) {
    return {message: "owner not found"}
  }
  var issue = await app.model.Issue.findAll({
    condition: { empid: owner.empid }
  });

  await new Promise((resolve, reject) => {
    data = [];
    issue.map(async(obj, index) => {
      var requester = await app.model.Requester.findAll({
        condition: {
            assetId: obj.transactionId,
            ownerStatus: "false",
            issuerStatus: "false",
        }
      });

      requester.forEach((item, i) => {
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
  await new Promise((resolve, reject) => {
    data.map(async(obj, index) => {
      var issue = await app.model.Issue.findOne({
        condition: { transactionId: obj.assetId }
      });
      var issuer = await app.model.Issuer.findOne({
        condition: { iid: issue.iid }
      });
      if(owner) {
        data[index].owner = {
          name: owner.name,
          email: owner.email,
          department: owner.department
        }
      }
      if(issuer) {
        data[index].issuer = {
          email: issuer.email
        }
      }
      if(index == data.length-1) {
          resolve();
      }
    })
  })

  return {
      message: "Asset list",
      data: data
  }
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
