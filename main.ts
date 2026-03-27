import axios, { AxiosError, AxiosResponse } from "axios";
import { configDotenv } from "dotenv";

const PatientGender = ["M", "F"] as const;
type PatientGender = typeof PatientGender[number];

type PatientDiagnosis = string; // ?
type PatientMedicationList = string; // ?

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

type PatientsResponse = {
    data: PatientResponse[];
    pagination: ResponsePagination;
    metadata: ResponseMetadata;
}

// Load API_KEY --> process.env.API_KEY
configDotenv();

console.log(process.env.API_KEY);