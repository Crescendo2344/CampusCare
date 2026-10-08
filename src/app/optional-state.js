// Initialize optional-feature state without importing its page implementation.
import {state as appState} from './state.js';
export function initializeOptionalState(){

  appState.reports.currentAnalyticsSummary=null;


  appState.reportCharts.lastReportRows=[];
  appState.reportCharts.lastReportTitle='Report';
  appState.reportCharts.reportChartInstance=null;
  appState.reportCharts.REPORT_METRICS={
  appointments:[
    {value:'status',label:'By Status'},
    {value:'clinic',label:'By Clinic'},
    {value:'college',label:'By College'},
    {value:'trend',label:'Trend Over Time (by date)'}
  ],
  treatments:[
    {value:'diagnosis',label:'By Diagnosis'},
    {value:'trend',label:'Trend Over Time (by date)'}
  ],
  inventory:[
    {value:'category',label:'By Category (Qty)'},
    {value:'stocklevel',label:'By Stock Level'},
    {value:'value',label:'Value by Category (₱)'}
  ],
  patients:[
    {value:'college',label:'By College'},
    {value:'type',label:'By Person Type'}
  ]
};
  appState.reportCharts.CHART_PALETTE=['#0a7ea8','#3aa8d8','#5b4fd6','#0b7d63','#c62828','#a15c00','#b0431e','#2e7d32','#5cb3ea','#a89bf5'];
  appState.reportCharts._reportChartTimeout=null;


  appState.camera.capturedSelfieDataUrl=null;
  appState.camera.capturedIdDataUrl=null;
  appState.camera._cameraStream=null;

}
