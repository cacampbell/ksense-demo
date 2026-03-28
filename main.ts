import axios, { AxiosError, isAxiosError } from "axios";
import { configDotenv } from "dotenv";
import { assert, error } from "node:console";
import { isNumberObject, isStringObject } from "node:util/types";
import { isNumericLiteral } from "typescript";

const PatientGender = ["M", "F"] as const;
type PatientGender = typeof PatientGender[number];

type PatientDiagnosis = string; // ?
type PatientMedicationList = string; // ?

type PatientBloodPressure = { systolic: number, diastolic: number };

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
    age?: string;
    gender?: PatientGender;
    blood_pressure?: string;
    temperature?: string;
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
    score: number | Empty;
}

type PatientsResponse = {
    data: PatientResponse[];
    pagination: ResponsePagination;
    metadata: ResponseMetadata;
}

type RiskAssessmentAlertLists = {
    high_risk_patients: string[]; // IDs
    fever_patients: string[]; // IDs
    data_quality_issues: string[]; // IDs
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

// parse age
function parseAge(ageString: string): number | null {
    if (!isNaN(Number.parseInt(ageString))) {
        return Number.parseInt(ageString);
    }
    return null;
}

// parse blood pressure from combined string
function parseBP(bloodPressureString: string): PatientBloodPressure | null {
    const pattern = /^\d{1,3}\/\d{1,3}$/; // X{XX}/Y{YY}
    if (!pattern.test(bloodPressureString)) return null;
    const parts = bloodPressureString.split("/");
    return {
        systolic: Number.parseInt(parts[0]),
        diastolic: Number.parseInt(parts[1])
    }
}

// parse temperature
function parseTemperature(tempString: string): number | null {
    if (!isNaN(Number.parseFloat(tempString))) {
        return Number.parseFloat(tempString);
    }
    return null;
}

// decontamination function that converts a PatientResponse to a Patient
function convertPatientData(patientResponse: PatientResponse): Patient {
    const patient = {
        patient_id: patientResponse.patient_id,
        name: patientResponse.name ?? null,
        age: patientResponse.age ? parseAge(patientResponse.age) : null,
        gender: patientResponse.gender ?? null,
        blood_pressure: patientResponse.blood_pressure ? parseBP(patientResponse.blood_pressure) : null,
        temperature: patientResponse.temperature ? parseTemperature(patientResponse.temperature) : null,
        visit_date: patientResponse.visit_date ? new Date(patientResponse.visit_date) : null,
        diagnosis: patientResponse.diagnosis ?? null,
        medications: patientResponse.medications ?? null,
        score: null
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
                // rate limited
                if (error.response?.status === 429) {
                    await Promise.resolve(async () => setTimeout(() => null, backoff));
                    continue;
                }

                // internal server error
                if (error.response?.status === 500 || error.response?.status === 503) {
                    continue;
                }
            }
        }
    }

    // quick checks
    assert(totalPatients === results.length);
    const totalUniqueIds = new Set(results.map((patient) => patient.patient_id)).size;
    assert(totalUniqueIds === results.length);
    
    return results;
}

// identify scuffed patient data entries
function assessMissingData(patients: Patient[]): string[] {
    return patients.map((patient) => {
        if (!patient.blood_pressure) return patient.patient_id;
        if (!patient.temperature) return patient.patient_id;
        if (!patient.age) return patient.patient_id;
        return null;
    }).filter((item) => item != null)
}

function assessBloodPressure(patient: Patient): number {
    // data quality check fail = score 0
    if (!patient.blood_pressure) return 0;

    // shorter
    const sys = patient.blood_pressure.systolic;
    const dia = patient.blood_pressure.diastolic;

    // use highest score for data that is present
    // sys >= 140 OR dia >= 90
    if (sys >= 140 || dia >= 90) return 3;
    // sys 130 - 139 OR dia 80 - 89
    if ((sys >= 130 && sys <= 139) || (dia >= 80 && dia <= 89)) return 2;
    // sys 120 - 129 AND dia < 80
    if ((sys >= 120 && sys <= 129) && dia < 80) return 1;
    // sys < 120 AND dia < 80
    if (sys < 120 && dia < 80) return 0;

    // Oops!
    throw new Error(`${patient.patient_id}: Invalid Blood Pressure!: ${patient.blood_pressure} (${sys} / ${dia})`);
}

function assessTemperature(patient: Patient): number {
    // data quality check fail = 0
    if (!patient.temperature) return 0;
    const temp = patient.temperature;

    // use highest score for data that is present
    // High Fever >= 101.0
    if (temp >= 101.0) return 2;
    // Low Fever 99.6 - 100.9
    if (temp >= 99.6 && temp < 101.0) return 1;
    // Normal
    if (temp < 99.6) return 0;

    // Oops!
    throw new Error(`${patient.patient_id}: Invalid Temperature!: ${patient.temperature}`);
}

function assessAge(patient: Patient): number {
    // data quality check fail = 0
    if (!patient.age) return 0;
    const age = patient.age;

    // use highest score for data that is present
    // Senior
    if (age > 65) return 2;
    if (age >= 40 && age <=65) return 1;
    if (age < 40) return 0;

    // Oops!
    throw new Error(`${patient.patient_id}: Invalid Age!: ${patient.age}`);
}

// screen for data quality issues then calculate risk scores
function calculateRiskScores(patients: Patient[]): RiskAssessmentAlertLists {
    const data_quality_issues: string[] = assessMissingData(patients);
    const fever_patients: string[] = [];
    const high_risk_patients: string[] = [];

    // score patients and add them to appropriate alert lists
    const scoredPatients = patients.map((patient) => {
        const bpScore = assessBloodPressure(patient);
        const tempScore = assessTemperature(patient);
        if (tempScore > 0) fever_patients.push(patient.patient_id);
        const ageScore = assessAge(patient);
        patient.score = bpScore + tempScore + ageScore;
        return patient;
    });

    // filter by score >= 4
    scoredPatients.map((patient) => {
        if (patient.score) {
            if (patient.score >= 4) {
                high_risk_patients.push(patient.patient_id);
            }
        }
    });

    return {
        data_quality_issues,
        high_risk_patients,
        fever_patients
    }
}

// Fetch patients
const patients = await getPatientData();

// Score patients
const alertLists = calculateRiskScores(patients);

// Submit for grading
const response = await api.post("submit-assessment", alertLists);
console.log(response.data);
