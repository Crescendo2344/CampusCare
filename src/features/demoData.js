// demoData: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
// ================================================================
// DATABASE
// ================================================================

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.data.DB={
  users: [
    {id:1,fname:'Jophet',lname:'Sanchez',username:'admin',password:'admin123',role:'Administrator',email:'jophet.sanchez@ctu.edu.ph',contact:'09171110001',status:'Active',college:'',personType:'Staff',idNo:'EMP-0001',idFile:'',createdAt:'2026-01-01',lastLogin:''},
    {id:2,fname:'Maria',lname:'Santos',username:'doctor1',password:'doc123',role:'Doctor',email:'m.santos@ctu.edu.ph',contact:'09171110002',status:'Active',college:'',personType:'Staff',idNo:'EMP-0002',idFile:'',specialty:'General Medicine',workDays:['Mon','Tue','Wed','Thu','Fri'],startTime:'08:00',endTime:'17:00',slotDuration:60,maxPatients:20,createdAt:'2026-01-01',lastLogin:''},
    {id:3,fname:'Jose',lname:'Reyes',username:'doctor2',password:'doc456',role:'Doctor',email:'j.reyes@ctu.edu.ph',contact:'09171110003',status:'Active',college:'',personType:'Staff',idNo:'EMP-0003',idFile:'',specialty:'General Medicine',workDays:['Mon','Tue','Wed','Thu','Fri'],startTime:'08:00',endTime:'17:00',slotDuration:60,maxPatients:20,createdAt:'2026-01-01',lastLogin:''},
    {id:4,fname:'Rosa',lname:'Mendez',username:'dentist1',password:'dent123',role:'Doctor',email:'r.mendez@ctu.edu.ph',contact:'09171110004',status:'Active',college:'',personType:'Staff',idNo:'EMP-0004',idFile:'',specialty:'Dental',workDays:['Mon','Tue','Wed','Thu'],startTime:'08:00',endTime:'16:00',slotDuration:60,maxPatients:15,createdAt:'2026-01-01',lastLogin:''},
    {id:5,fname:'Anna',lname:'Cruz',username:'staff1',password:'staff123',role:'Staff',email:'a.cruz@ctu.edu.ph',contact:'09171110005',status:'Active',college:'',personType:'Staff',idNo:'EMP-0005',idFile:'',department:'Medical Clinic',createdAt:'2026-01-01',lastLogin:''},
    {id:6,fname:'Juan',lname:'dela Cruz',username:'patient1',password:'pat123',role:'Patient',email:'juan@ctu.edu.ph',contact:'09271110006',status:'Active',college:'CCICT',personType:'Student',idNo:'2022-00006',idFile:'',verified:true,createdAt:'2026-01-01',lastLogin:''},
    {id:9,fname:'Ana',lname:'Lim',username:'patient4',password:'pat000',role:'Patient',email:'ana@ctu.edu.ph',contact:'09271110004',status:'Active',college:'COED',personType:'Teaching Personnel',idNo:'EMP-T-0001',idFile:'sample_id.jpg',verified:true,createdAt:'2026-02-01',lastLogin:''},
  ],
  nextUserId:10,

  patients: [
    {id:1,userId:6,fname:'Juan',lname:'dela Cruz',age:21,gender:'Male',blood:'O+',address:'Brgy 1, Culasi',college:'CCICT',personType:'Student',idNo:'2022-00001',height:'170cm',weight:'65kg',emergencyContact:'09171234567',emergencyName:'Pedro dela Cruz',medHistory:'No known allergies',allergies:'None',createdAt:'2026-01-15'},
    {id:2,userId:7,fname:'Maria',lname:'Reyes',age:20,gender:'Female',blood:'A+',address:'Brgy 2, Culasi',college:'COE',personType:'Student',idNo:'2022-00002',height:'158cm',weight:'52kg',emergencyContact:'09181234567',emergencyName:'Nena Reyes',medHistory:'Asthmatic',allergies:'Penicillin',createdAt:'2026-01-20'},
    {id:3,userId:9,fname:'Ana',lname:'Lim',age:34,gender:'Female',blood:'B+',address:'Brgy 3, Culasi',college:'COED',personType:'Teaching Personnel',idNo:'EMP-T-0001',height:'160cm',weight:'55kg',emergencyContact:'09191234567',emergencyName:'Bert Lim',medHistory:'Hypertensive',allergies:'None',createdAt:'2026-02-01'},
  ],
  nextPatientId:4,

  appointments: [
    {id:1,patientId:1,doctorId:2,clinic:'Medical Clinic',service:'General Checkup',date:'2026-05-01',time:'09:00',status:'Completed',priority:'Student',college:'CCICT',createdBy:5,reason:'Regular checkup',notes:'BP normal',createdAt:'2026-04-28'},
    {id:2,patientId:2,doctorId:4,clinic:'Dental Clinic',service:'Dental Checkup',date:'2026-03-10',time:'10:00',status:'Completed',priority:'Student',college:'COE',createdBy:5,reason:'Toothache',notes:'Tooth extracted',createdAt:'2026-03-08'},
    {id:3,patientId:1,doctorId:2,clinic:'Medical Clinic',service:'Follow-up',date:'2026-05-20',time:'14:00',status:'Scheduled',priority:'Student',college:'CCICT',createdBy:6,reason:'Follow-up on URTI',notes:'',createdAt:'2026-05-10'},
    {id:4,patientId:3,doctorId:3,clinic:'Medical Clinic',service:'General Checkup',date:'2026-05-15',time:'09:00',status:'Scheduled',priority:'Teaching',college:'COED',createdBy:9,reason:'Annual checkup',notes:'',createdAt:'2026-05-10'},
  ],
  nextApptId:5,

  treatments: [
    {id:1,patientId:1,doctorId:2,appointmentId:1,diagnosis:'URTI',prescription:'Amoxicillin 500mg 3x7days, Paracetamol 500mg PRN',findings:'Pharyngeal erythema, no tonsillar enlargement',notes:'Rest, hydration. Return if fever persists >3 days.',vitals:{bp:'120/80',temp:'37.2',pulse:'78',spo2:'98%',weight:'65kg'},date:'2026-05-01',followupDate:'2026-05-08',createdAt:'2026-05-01 09:30'},
    {id:2,patientId:2,doctorId:4,appointmentId:2,diagnosis:'Dental Caries - Lower Right Molar',prescription:'Amoxicillin 500mg + Mefenamic 500mg',findings:'Carious lesion on tooth 46, percussion positive',notes:'Tooth 46 extracted. Soft diet 3 days. Return for socket check.',vitals:{bp:'-',temp:'36.8',pulse:'80',spo2:'99%',weight:'52kg'},date:'2026-03-10',followupDate:'2026-03-17',createdAt:'2026-03-10 10:30'},
  ],
  nextTreatId:3,

  inventory: [
    {id:1,name:'Amoxicillin 500mg',category:'Medicine',qty:150,threshold:30,unit:'capsules',expiryDate:'2027-06-30',disbursementDate:'2026-06-01',supplier:'PharmaCo',unitCost:5.50},
    {id:2,name:'Mefenamic Acid 500mg',category:'Medicine',qty:80,threshold:25,unit:'tablets',expiryDate:'2027-03-31',disbursementDate:'2026-06-01',supplier:'PharmaCo',unitCost:4.00},
    {id:3,name:'Paracetamol 500mg',category:'Medicine',qty:200,threshold:50,unit:'tablets',expiryDate:'2027-12-31',disbursementDate:'2026-06-01',supplier:'MedSupply',unitCost:2.50},
    {id:4,name:'Dental Anesthesia (Lidocaine)',category:'Dental',qty:8,threshold:10,unit:'vials',expiryDate:'2026-12-31',disbursementDate:'2026-06-01',supplier:'DentaCorp',unitCost:85.00},
    {id:5,name:'Surgical Gloves - Medium',category:'Supplies',qty:5,threshold:20,unit:'boxes',expiryDate:'2028-01-01',disbursementDate:'2026-06-01',supplier:'MedSupply',unitCost:120.00},
    {id:6,name:'Ibuprofen 400mg',category:'Medicine',qty:60,threshold:20,unit:'tablets',expiryDate:'2027-09-30',disbursementDate:'2026-06-01',supplier:'PharmaCo',unitCost:6.00},
    {id:7,name:'Bandage Rolls',category:'Supplies',qty:40,threshold:15,unit:'rolls',expiryDate:'2029-01-01',disbursementDate:'2026-06-01',supplier:'MedSupply',unitCost:35.00},
    {id:8,name:'BP Monitor',category:'Equipment',qty:3,threshold:2,unit:'pcs',expiryDate:'',disbursementDate:'',supplier:'EquipCo',unitCost:1800.00},
    {id:9,name:'Thermometer',category:'Equipment',qty:12,threshold:5,unit:'pcs',expiryDate:'',disbursementDate:'',supplier:'EquipCo',unitCost:250.00},
    {id:10,name:'Dental Extraction Kit',category:'Dental',qty:2,threshold:3,unit:'sets',expiryDate:'',disbursementDate:'',supplier:'DentaCorp',unitCost:4500.00},
  ],
  nextInvId:11,

  healthResources: [
  { id: 1, title: "Feeling Overwhelmed? Practical Ways to Manage Stress This Semester", category: "Stress Management", icon: "🧘", teaser: "Exams, deadlines, and campus life can pile up fast. Here's what actually helps, according to public health guidance — from protecting your sleep to taking real breaks from your phone.", content: "Stress is a normal part of student life, but left unmanaged it can affect your sleep, focus, and physical health. A few evidence-backed habits make a real difference: keep a consistent sleep schedule and aim for at least 7 hours a night, build in short daily breaks for deep breathing or stretching, stay physically active even in small bursts, and limit doom-scrolling on news and social media. Journaling three things you're grateful for each day and talking openly with people you trust are also linked to lower stress levels over time. If stress starts interfering with your classes or relationships, that's a sign to reach out — CampusCare's clinic staff and counselors are here for exactly that.", sourceName: "U.S. CDC — Managing Stress", sourceUrl: "https://www.cdc.gov/mental-health/living-with/index.html", authorId: 1, createdAt: "2026-06-02", published: true },
  { id: 2, title: "Eating Well on a Student Budget: Simple Nutrition Wins", category: "Nutrition", icon: "🥗", teaser: "You don't need a perfect diet — just a few consistent habits. Here's how to get more fiber, protein, and real food into your day without overhauling everything.", content: "Good nutrition isn't about strict rules — it's about consistently choosing whole, nutrient-dense foods most of the time. Build meals around vegetables, fruits, whole grains, and a protein source like eggs, beans, fish, or poultry. Watch out for sodium hiding in processed and packaged foods — reading nutrition labels helps. Simple swaps go a long way: add fruit to your cereal, keep sliced vegetables on hand for snacking, and choose fortified or low-fat dairy when you can. None of this has to be expensive or complicated — small, repeatable choices add up over a semester.", sourceName: "U.S. CDC — Healthy Eating Tips", sourceUrl: "https://www.cdc.gov/nutrition/features/healthy-eating-tips.html", authorId: 1, createdAt: "2026-06-05", published: true },
  { id: 3, title: "Why That Afternoon Slump Might Just Be Dehydration", category: "Nutrition", icon: "💧", teaser: "Skipping water for coffee and soda is an easy habit to fall into on campus. Here's why it matters and how much you actually need.", content: "Staying hydrated helps your body regulate temperature, cushion your joints, and keep your mind clear — dehydration is a common, overlooked cause of headaches, fatigue, and poor concentration. Water is the best default choice since it has no calories, but milk, unsweetened tea, and diluted fruit juice can also count toward your daily intake. Sugary drinks like soda and energy drinks provide calories with little nutritional benefit, so it's worth rethinking how often you reach for them, especially between classes.", sourceName: "U.S. CDC — Water & Healthier Drinks", sourceUrl: "https://www.cdc.gov/healthy-weight-growth/water-healthy-drinks/index.html", authorId: 1, createdAt: "2026-06-08", published: true },
  { id: 4, title: "Minor Cut or Scrape? Here's the Right Way to Treat It", category: "First Aid", icon: "🩹", teaser: "Most small wounds heal fine at home if you clean and cover them properly. Here's the step-by-step most clinics follow — and the warning signs that mean you should come in.", content: "Wash your hands first to avoid introducing bacteria into the wound. Apply gentle pressure with a clean cloth to stop any bleeding, then rinse the wound under running water — soap around the wound is fine, but avoid getting it directly in the cut, and skip hydrogen peroxide or iodine, which can actually slow healing. A thin layer of antibiotic ointment or petroleum jelly helps keep it moist, and covering it with a bandage keeps it clean; change the dressing daily or whenever it gets wet or dirty. See a clinician if you notice redness spreading, increasing pain, warmth, swelling, or discharge — these can be signs of infection — or if it's been more than five years since your last tetanus shot and the wound is deep or dirty.", sourceName: "Mayo Clinic — Cuts and Scrapes: First Aid", sourceUrl: "https://www.mayoclinic.org/first-aid/first-aid-cuts/basics/art-20056711", authorId: 2, createdAt: "2026-06-10", published: true },
  { id: 5, title: "Living in Dorms? Here's Why the Meningitis Vaccine Matters", category: "Vaccination", icon: "💉", teaser: "Shared living spaces raise the risk of a rare but serious bacterial infection. Here's what health authorities recommend for students heading into campus housing.", content: "Meningococcal disease is uncommon but serious, and it spreads more easily in close-contact settings like dormitories, shared meals, and crowded lecture halls — conditions that make first-year students living on campus a higher-risk group. Health authorities recommend the MenACWY vaccine for adolescents, with a booster around age 16, and many colleges require proof of vaccination for students moving into dorms. A separate vaccine, MenB, is also available and worth discussing with a clinician, especially if there's been a recent outbreak in your area. If you're not sure about your vaccination history, our clinic staff can help you check and catch up.", sourceName: "U.S. CDC — Meningococcal Vaccines for Preteens and Teens", sourceUrl: "https://www.cdc.gov/meningococcal/vaccines/preteens-teens.html", authorId: 1, createdAt: "2026-06-12", published: true },
  { id: 6, title: "Why Sleep Is the Most Underrated Study Tool You Have", category: "Mental Health", icon: "😴", teaser: "Pulling all-nighters feels productive, but the science says otherwise. Here's what consistent sleep actually does for your memory, mood, and immune system.", content: "Adults generally need at least 7 hours of sleep a night, yet a large share of college students routinely get less — often trading it for study time or social life. The trade-off tends to backfire: insufficient sleep is linked to weaker attention and memory, a higher risk of getting sick, and a harder time regulating mood and stress. Good sleep habits help: go to bed and wake up at consistent times (even on weekends), keep your room dark, quiet, and cool, and avoid screens, caffeine, and heavy meals in the hour or two before bed. If persistent sleep problems are affecting your daily life, it's worth talking to a clinician rather than just pushing through.", sourceName: "U.S. CDC — About Sleep", sourceUrl: "https://www.cdc.gov/sleep/about/index.html", authorId: 2, createdAt: "2026-06-15", published: true },
  { id: 7, title: "Sexual Health 101: Testing, Prevention, and Where to Start", category: "Sexual Health", icon: "🛡️", teaser: "STIs are common and mostly preventable — but many don't cause obvious symptoms, so testing is the only way to really know your status. Here's a straightforward overview.", content: "Young adults account for a large share of new sexually transmitted infections each year, in part because many STIs don't cause noticeable symptoms — testing is often the only reliable way to know your status. Safer sex practices like consistent condom use, open conversations with partners, and regular testing all meaningfully lower risk. General guidance suggests sexually active women under 25 get tested annually for chlamydia and gonorrhea, and that everyone aged 13–64 be tested at least once for HIV, with more frequent testing depending on individual risk factors. A clinician can help you figure out what testing schedule makes sense for you — it's a routine, judgment-free part of healthcare.", sourceName: "U.S. CDC — How to Prevent STIs", sourceUrl: "https://www.cdc.gov/sti/prevention/index.html", authorId: 2, createdAt: "2026-06-18", published: true },
  { id: 8, title: "You Don't Need the Gym: What 150 Minutes a Week Really Looks Like", category: "Nutrition", icon: "🏃", teaser: "The official recommendation sounds like a lot until you break it down. Here's how brisk walking, cycling, or even chores can add up to real health benefits.", content: "The general guideline for adults is about 150 minutes of moderate-intensity activity a week — that's roughly 30 minutes a day, five days a week — plus muscle-strengthening activity on two or more days. It doesn't have to happen all at once or in a gym: brisk walking between classes, cycling, dancing, or even a brisk household chore session all count toward the total, and any activity is better than none. Building the habit gradually and picking activities you actually enjoy makes it far more sustainable than forcing a rigid workout plan.", sourceName: "U.S. CDC — What Counts as Physical Activity", sourceUrl: "https://www.cdc.gov/physical-activity-basics/adding-adults/what-counts.html", authorId: 1, createdAt: "2026-06-20", published: true },
  ],
  nextResourceId: 9,

  messages: [
  { id: 1, fromUserId: 6, toUserId: 2, subject: "Headache persists", message: "I still have a headache after taking Paracetamol.", createdAt: "2026-05-10 10:30", isRead: false, replyToId: null },
  { id: 2, fromUserId: 2, toUserId: 6, subject: "RE: Headache persists", message: "Please come for a follow-up if symptoms continue.", createdAt: "2026-05-11 09:15", isRead: true, replyToId: 1 },
  ],
  nextMessageId: 3,

  medReminders: [
  { id: 1, patientId: 1, medicationName: "Amoxicillin 500mg", dosage: "3 times a day", startDate: "2026-05-01", endDate: "2026-05-08", timeOfDay: ["08:00","14:00","20:00"], lastSent: null, status: "active" },
  ],
  nextReminderId: 2,

  notifications: [],
  nextNotifId:1,

  // Historical usage powers the predictive-inventory demo.
  // These are normal disbursement records, so new disbursements automatically
  // improve the forecast without a separate data structure.
  disbursements: [
    {id:1,itemId:3,qty:36,date:'2026-08-18',notes:'Routine clinic dispensing',userId:5},
    {id:2,itemId:3,qty:42,date:'2026-08-27',notes:'Routine clinic dispensing',userId:5},
    {id:3,itemId:3,qty:48,date:'2026-09-05',notes:'Routine clinic dispensing',userId:5},
    {id:4,itemId:1,qty:18,date:'2026-08-20',notes:'Dispensed per prescriptions',userId:5},
    {id:5,itemId:1,qty:24,date:'2026-09-03',notes:'Dispensed per prescriptions',userId:5},
    {id:6,itemId:5,qty:2,date:'2026-08-22',notes:'Clinic consumption',userId:5},
    {id:7,itemId:5,qty:3,date:'2026-09-06',notes:'Clinic consumption',userId:5},
    {id:8,itemId:7,qty:6,date:'2026-09-01',notes:'Clinic consumption',userId:5}
  ],
  nextDisbId:9,

  doctorLeaves: [],
  nextLeaveId:1,

  certRequests: [],
  nextCertId:1,

  // Fitness-to-compete assessments and audit events are persisted just like
  // the other prototype records and can later map to backend database tables.
  fitnessAssessments: [],
  nextFitnessId:1,
  activityLogs: [],
  nextActivityLogId:1,

  settings: {
    semesterStart:'2026-01-01',
    semesterEnd:'2026-06-30',
    semester2Start:'2026-07-01',
    semester2End:'2026-12-31',
    dentalLimitPerSemester:1,
    appointmentReminderDays:2,
    lunchBreakStart:'12:00',
    lunchBreakEnd:'13:00',
    slotOverrides:[],
    clinicName:'CTU Main Medical & Dental Clinic',
    address:'Ground Floor, Education Building, CTU Main Campus, M.J. Cuenco Ave. cor. R. Palma St., Cebu City, Philippines',
    contactEmail:'ctumainmedclinic@gmail.com',
    contactPhone:'(032) 402 4060 loc. 1142',
    privacyPolicyVersion:'1.0',
    privacyPolicyUpdated:'2026-09-12',
    backupRetentionDays:7,
  }
};
}
