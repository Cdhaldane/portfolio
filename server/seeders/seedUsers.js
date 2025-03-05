// seeders/seedUsers.js
const { User } = require("../models"); // Import your User model
const faker = require("faker"); // For generating dummy data

async function seedUsers() {
  try {
    // Create an array of dummy users
    const dummyUsers = Array.from({ length: 10 }, () => ({
      username: faker.internet.userName(),
      email: faker.internet.email(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Insert dummy users into the database
    await User.bulkCreate(dummyUsers);

    console.log("Dummy users seeded successfully!");
  } catch (error) {
    console.error("Error seeding users:", error);
  }
}

// Run the seeder
seedUsers();
