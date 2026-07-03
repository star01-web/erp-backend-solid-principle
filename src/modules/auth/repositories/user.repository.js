const { Op } = require("sequelize");
const BaseRepository = require("../../../common/BaseRepository");

/**
 * Data access for the User (login) table.
 */
class UserRepository extends BaseRepository {
  findByEmail(email, options = {}) {
    return this.findOne({ email }, options);
  }

  findByEmailOrUsername(email, username, options = {}) {
    return this.findOne(
      { [Op.or]: [{ email }, { username: username || email }] },
      options,
    );
  }
}

module.exports = UserRepository;
