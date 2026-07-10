var http = require('http');
var users = require('./routes/users');

var server = http.createServer(function (req, res) {
  if (req.url === '/users' && req.method === 'GET') {
    return users.listUsers(req, res);
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

var port = process.env.PORT || 3000;
server.listen(port, function () {
  console.log('legacy-commonjs server listening on ' + port);
});

module.exports = server;
