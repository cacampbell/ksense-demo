import { configDotenv } from "dotenv";
const PatientGender = ["M", "F"];
// Load API_KEY --> process.env.API_KEY
configDotenv();
console.log(process.env.API_KEY);
