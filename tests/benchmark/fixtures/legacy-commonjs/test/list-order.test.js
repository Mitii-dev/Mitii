var test = require('node:test');
var assert = require('node:assert');
var listUsers = require('../routes/users').listUsers;

test('GET /users returns users in the same order as data/users.json', function (t, done) {
  var res = {
    writeHead: function () {},
    end: function (body) {
      var users = JSON.parse(body);
      assert.deepStrictEqual(
        users.map(function (u) { return u.id; }),
        [1, 2, 3]
      );
      done();
    }
  };
  listUsers({}, res);
});
