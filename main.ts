import axios, { AxiosError, isAxiosError } from "axios";
import { configDotenv } from "dotenv";
import { assert } from "node:console";

const PatientGender = ["M", "F"] as const;
type PatientGender = typeof PatientGender[number];

type PatientDiagnosis = string; // ?
type PatientMedicationList = string; // ?

type PatientBloodPressure = { systolic: number, diastoic: number };

type ResponsePagination = {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
};

type ResponseMetadata = {
    timestamp: Date;
    version: string;
    requestId: string;
};

// Optional fields may be missing
interface PatientResponse {
    patient_id: string;
    name?: string;
    age?: number;
    gender?: PatientGender;
    blood_pressure?: string;
    temperature?: number;
    visit_date?: string;
    diagnosis?: PatientDiagnosis;
    medications?: PatientMedicationList;
}

type Empty = null; // Could be a signifier as well
type Patient = {
    patient_id: string;
    name: string | Empty;
    age: number | Empty;
    gender: PatientGender | Empty;
    blood_pressure: PatientBloodPressure | Empty;
    temperature: number | Empty;
    visit_date: Date | Empty;
    diagnosis: PatientDiagnosis | Empty;
    medications: PatientMedicationList | Empty;
}

type PatientsResponse = {
    data: PatientResponse[];
    pagination: ResponsePagination;
    metadata: ResponseMetadata;
}

// Create api client
const api = axios.create({
    baseURL: "https://assessment.ksensetech.com/api/"
})

// Load API_KEY --> process.env.API_KEY
configDotenv();
const API_KEY = process.env.API_KEY;
api.defaults.headers.common["x-api-key"] = API_KEY;

// initial parameters
const page = 1; // first page
const limit = 20; // max per page
const params = { page, limit };
api.defaults.params = params;

// parse blood pressure from combined string
function parseBP(bloodPressureString: string): PatientBloodPressure {
    const parts = bloodPressureString.split("/");
    return {
        systolic: Number.parseInt(parts[0]),
        diastoic: Number.parseInt(parts[1])
    }
}

// decontamination function that converts a PatientResponse to a Patient
function convertPatientData(patientResponse: PatientResponse): Patient {
    const patient = {
        patient_id: patientResponse.patient_id,
        name: patientResponse.name ?? null,
        age: patientResponse.age ?? null,
        gender: patientResponse.gender ?? null,
        blood_pressure: patientResponse.blood_pressure ? parseBP(patientResponse.blood_pressure) : null,
        temperature: patientResponse.temperature ?? null,
        visit_date: patientResponse.visit_date ? new Date(patientResponse.visit_date) : null,
        diagnosis: patientResponse.diagnosis ?? null,
        medications: patientResponse.medications ?? null
    }
    return patient;
}

// function that gets all patient data once and converts it to domain objects
async function getPatientData(): Promise<Patient[]> {
    var results: Patient[] = [];
    const backoff = 200;
    var maxPages = -1;
    var totalPatients = -1;

    while (true) {
        try {
            const response = (await api.get<PatientsResponse>("patients")).data;
            
            // Note total patients expected
            totalPatients = response.pagination.total;

            // Get max pages
            maxPages = response.pagination.totalPages;

            // Add patient data to total list
            const intResults = response.data.map((patientResp: PatientResponse) => convertPatientData(patientResp));
            results = results.concat(intResults);
            
            // If more than one page and currently on a lesser page, increment page
            if (api.defaults.params["page"] == maxPages) {
                break;
            } else {
                api.defaults.params["page"] += 1;
            }
        } catch (error) {
            if (isAxiosError(error)) {
                if (error.response?.status === 429) { // rate limited
                    await Promise.resolve(async () => setTimeout(() => null, backoff));
                    continue;
                }
            }
        }
    }

    // quick check
    assert(totalPatients == results.length);
    return results;
}

// Fetch patients
const patients = await getPatientData();
console.log(patients);