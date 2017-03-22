// Expected env settings
var slack_token = process.env.SLACK_TOKEN;
var buildkite_api_token = process.env.BUILDKITE_API_TOKEN;
var buildkite_default_org_slug  = process.env.BUILDKITE_DEFAULT_ORG_SLUG;

var https      = require('https');
var express    = require('express');
var bodyParser = require('body-parser');

var app = express();
app.use(bodyParser.urlencoded());

app.post('/', function(req, res){

  console.log('Received POST', req.headers, req.body);

  if (req.body.token != slack_token) {
    console.log("Invalid Slack token");
    return res.status(401).send('Invalid token');
  }

  var command = req.body.text.split(" ")[0];

  switch (command) {
    //add your own commands here
    case "build":
      build_command(req, res);
      break;
    case "unblock":
      unblock_command(req, res);
      break;
    default:
      usage_help(res);
  }
});

app.listen(process.env.PORT || 3000, function() {
  console.log('Express listening on port', this.address().port);
});

function usage_help(res) {
  res.send([
    "Available commands:",
    "build <org default:" + buildkite_default_org_slug + ">/<project> \"<message>\" <branch default:master> <commit default:HEAD> (e.g. build spacex/rockets)",
    "unblock <org default:" + buildkite_default_org_slug + ">/<project>"
    // Add your own command help here
  ].join("\n"));
}

function build_command(req, res) {
  var buildCommandMatch = req.body.text.match(/^build (.*?) ["“](.*?)["”](?: ([^ ]+))?(?: ([^ ]+))?/);
  if (!buildCommandMatch) return usage_help(res);

  var orgProjMatch = buildCommandMatch[1].match(/(.*)\/(.*)/);
  if (orgProjMatch) {
    var org = orgProjMatch[1];
    var project = orgProjMatch[2];
  } else {
    var org = buildkite_default_org_slug;
    var project = buildCommandMatch[1];
  }

  var message = buildCommandMatch[2];
  var branch = buildCommandMatch[3] || "master";
  var commit = buildCommandMatch[4] || "HEAD";

  console.log("Build command", buildCommandMatch, org, project, message);

  request_to_buildkite('POST', '/v1/organizations/' + org + '/projects/' + project + '/builds', {
    branch: branch,
    commit: commit,
    message: message
  }, function(responseCode, responseBody) {
    console.log("Build API response", responseCode, responseBody)
    if (responseCode >= 300) {
      return res.send("Buildkite API failed: " + responseCode + " " + responseBody);
    } else {
      var responseJson = JSON.parse(responseBody);
      return res.send("Build created! " + responseJson.web_url);
    }
  });
}

function unblock_command(req, res) {
  var unblockCommandMatch = req.body.text.match(/^unblock (.*)/);
  if (!unblockCommandMatch) return usage_help(res);

  var orgProjMatch = unblockCommandMatch[1].match(/(.*)\/(.*)/);
  if (orgProjMatch) {
    var org = orgProjMatch[1];
    var project = orgProjMatch[2];
  } else {
    var org = buildkite_default_org_slug;
    var project = unblockCommandMatch[1];
  }

  console.log("Unblock command", unblockCommandMatch, org, project);

  request_to_buildkite('GET', '/v1/organizations/' + org + '/projects/' + project + '/builds?state=blocked', {},
  function(responseCode, responseBody) {
    console.log("Build API response", responseCode, responseBody);

    if (responseCode >= 300) {
      return res.send("Buildkite API failed: " + responseCode + " " + responseBody);
    } else {
      var builds = JSON.parse(responseBody);
      var unblockedBuilds = 0;
      builds.forEach(function(build, i) {
        build.jobs.forEach(function(job, ii) {
          if (job.unblockable) {
            request_to_buildkite('PUT', job.unblock_url, {}, function(unblockResCode, unblockResBody) {
              console.log("Unblock API response", unblockResCode, unblockResBody);
            });
            unblockedBuilds++;
          }
        });
      })
      return res.send(unblockedBuilds + " jobs unblocked!");
    }
  });
}

function request_to_buildkite(method, path, params, callback) {
  var body = JSON.stringify(params);

  console.log("Posting to Buildkite", path, body);

  var req = https.request({
    hostname: 'api.buildkite.com',
    port: 443,
    path: path,
    method: method,
    headers: {
      "Content-type":   "application/json",
      "Connection":     "close",
      "Content-length": body.length,
      "Authorization":  "Bearer " + buildkite_api_token,
    }
  }, function(res) {
    var body = "";
    res.on("data", function(data) {
      body += data.toString();
    });
    res.on("end", function() {
      console.log("Buildkite API response", res.statusCode, body);
      callback(res.statusCode, body);
    });
  });

  req.write(body);
  req.end();
}
