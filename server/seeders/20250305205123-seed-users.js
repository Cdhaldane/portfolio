"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.bulkInsert("Users", [
      {
        username: "john_doe",
        email: "john@example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        username: "jane_doe",
        email: "jane@example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },
  down: async (queryInterface) => {
    await queryInterface.bulkDelete("Users", null, {});
  },
};
