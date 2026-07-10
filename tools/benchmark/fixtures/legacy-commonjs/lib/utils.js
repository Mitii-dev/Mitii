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
  setTimeout(function () {
    callback(null, {
      id: user.id,
      label: user.name + ' <' + user.email + '>'
    });
  }, 0);
}

module.exports = {
  readJsonFile: readJsonFile,
  formatUser: formatUser
};
