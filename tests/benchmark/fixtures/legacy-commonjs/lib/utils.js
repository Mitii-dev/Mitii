var fs = require('fs');

function readJsonFile(path, callback) {
  fs.readFile(path, 'utf8', function (err, data) {
    if (err) {
      return callback(err);
    }
    var parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseErr) {
      return callback(parseErr);
    }
    return callback(null, parsed);
  });
}

function formatUser(user, callback) {
  // Simulated variable latency per user (e.g. different backing stores).
  // BUG: combined with routes/users.js's callback-counting aggregation,
  // this lets a slower earlier user resolve after a faster later one,
  // reordering the response.
  var delay = (4 - user.id) * 15;
  setTimeout(function () {
    callback(null, {
      id: user.id,
      label: user.name + ' <' + user.email + '>'
    });
  }, delay);
}

module.exports = {
  readJsonFile: readJsonFile,
  formatUser: formatUser
};
