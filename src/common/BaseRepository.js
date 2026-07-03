/**
 * Generic data-access base. Wraps a single injected Sequelize model so that
 * services depend on a repository abstraction (Dependency Inversion) rather
 * than calling Sequelize directly. Concrete repositories extend this and add
 * domain-specific queries.
 *
 * All options objects are passed straight through to Sequelize, so callers can
 * still use `transaction`, `lock`, `include`, `attributes`, `order`, etc.
 */
class BaseRepository {
  constructor(model) {
    if (!model) {
      throw new Error("BaseRepository requires a Sequelize model");
    }
    this.model = model;
  }

  findById(id, options = {}) {
    return this.model.findByPk(id, options);
  }

  findOne(where = {}, options = {}) {
    return this.model.findOne({ where, ...options });
  }

  findAll(where = {}, options = {}) {
    return this.model.findAll({ where, ...options });
  }

  findAndCountAll(options = {}) {
    return this.model.findAndCountAll(options);
  }

  findOrCreate(options) {
    return this.model.findOrCreate(options);
  }

  create(data, options = {}) {
    return this.model.create(data, options);
  }

  bulkCreate(records, options = {}) {
    return this.model.bulkCreate(records, options);
  }

  update(values, where, options = {}) {
    return this.model.update(values, { where, ...options });
  }

  destroy(where, options = {}) {
    return this.model.destroy({ where, ...options });
  }

  count(where = {}, options = {}) {
    return this.model.count({ where, ...options });
  }

  sum(field, where = {}, options = {}) {
    return this.model.sum(field, { where, ...options });
  }
}

module.exports = BaseRepository;
