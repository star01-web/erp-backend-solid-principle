const { Op } = require("sequelize");
const BaseRepository = require("../../../common/BaseRepository");

/**
 * Data access for the EmployeeMaster table.
 */
class EmployeeRepository extends BaseRepository {
  findByUserId(userId, options = {}) {
    return this.findOne({ user_id: userId }, options);
  }

  findByPhone(phone, options = {}) {
    return this.findOne({ phone }, options);
  }

  findTeam(supervisorId, options = {}) {
    return this.findAll({ supervisor_id: supervisorId }, options);
  }

  /** Match by email OR either user_id column variant (token lookups). */
  findByEmailOrUserId(email, userId, options = {}) {
    return this.findOne(
      { [Op.or]: [{ email }, { user_id: userId }] },
      options,
    );
  }
}

module.exports = EmployeeRepository;
