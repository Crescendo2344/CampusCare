// Optional UI imports preserve promise/error propagation and reject stale page loads.
import {state} from './state.js';
export async function syncReportsContext(...args){const feature=await import('../features/reports.js');return feature.syncReportsContext(...args);}
export async function renderReports(...args){const token=state.navigationRaceProtection.campusNavigationToken;const feature=await import('../features/reports.js');if(token!==state.navigationRaceProtection.campusNavigationToken)return;return feature.renderReports(...args);}
export async function updateReportMetricOptions(...args){const feature=await import('../features/reportCharts.js');return feature.updateReportMetricOptions(...args);}
export async function vizCardHtml(...args){const feature=await import('../features/reportCharts.js');return feature.vizCardHtml(...args);}
export async function computeMetricData(...args){const feature=await import('../features/reportCharts.js');return feature.computeMetricData(...args);}
export async function renderReportChart(...args){const feature=await import('../features/reportCharts.js');return feature.renderReportChart(...args);}
export async function renderReportChartNow(...args){const feature=await import('../features/reportCharts.js');return feature.renderReportChartNow(...args);}
export async function exportToolbarHtml(...args){const feature=await import('../features/reportCharts.js');return feature.exportToolbarHtml(...args);}
export async function downloadBlob(...args){const feature=await import('../features/reportCharts.js');return feature.downloadBlob(...args);}
export async function rowsToCSV(...args){const feature=await import('../features/reportCharts.js');return feature.rowsToCSV(...args);}
export async function exportReportCSV(...args){const feature=await import('../features/reportCharts.js');return feature.exportReportCSV(...args);}
export async function loadSheetJs(...args){const feature=await import('../features/reportCharts.js');return feature.loadSheetJs(...args);}
export async function exportReportExcel(...args){const feature=await import('../features/reportCharts.js');return feature.exportReportExcel(...args);}
export async function exportReportWord(...args){const feature=await import('../features/reportCharts.js');return feature.exportReportWord(...args);}
export async function exportReportPDF(...args){const feature=await import('../features/reportCharts.js');return feature.exportReportPDF(...args);}
export async function generateReport(...args){const feature=await import('../features/reportCharts.js');return feature.generateReport(...args);}
export async function openCamera(...args){const feature=await import('../features/camera.js');return feature.openCamera(...args);}
export async function stopCamera(...args){const feature=await import('../features/camera.js');return feature.stopCamera(...args);}
export async function captureCameraPhoto(...args){const feature=await import('../features/camera.js');return feature.captureCameraPhoto(...args);}
export const reports={syncReportsContext,renderReports,initializeFeature(){}};
export const reportCharts={updateReportMetricOptions,vizCardHtml,computeMetricData,renderReportChart,renderReportChartNow,exportToolbarHtml,downloadBlob,rowsToCSV,exportReportCSV,loadSheetJs,exportReportExcel,exportReportWord,exportReportPDF,generateReport,initializeFeature(){}};
export const camera={openCamera,stopCamera,captureCameraPhoto,initializeFeature(){}};
