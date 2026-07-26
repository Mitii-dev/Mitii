var utils = require('../lib/utils');

function listUsers(req, res) {
  utils.readJsonFile(__dirname + '/../data/users.json', function (err, users) {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'could not load users' }));
      return;
    }
    var results = [];
    var remaining = users.length;
    if (remaining === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
      return;
    }
    users.forEach(function (user) {
      utils.formatUser(user, function (formatErr, formatted) {
        results.push(formatted);
        remaining -= 1;
        if (remaining === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
        }
      });
    });
  });
}

module.exports = { listUsers: listUsers };
