"""Build the labelled condition-classifier dataset.

    python ml/make_dataset.py            # writes ml/data/train.jsonl, ml/data/test.jsonl

The data is synthetic. Real users do not exist in this repository, so the only
honest options are to ship no classifier or to ship one trained on
hand-written, clearly-labelled templates. We do the latter and say so
everywhere the scores appear (ml/reports/eval.md, docs/RECOMMEND_API.md): a
score on this test set measures whether the model learned the phrasings we
wrote down, not how it behaves on language we have never seen.

Three guarantees the tests check:

  Separation   train and test are generated from disjoint template sets and
               disjoint phrase pools, then checked for identical strings. A
               test item that also appears in training would measure
               memorization.

  Fair sample  the two phrase pools are disjoint as *strings* but drawn from the
               same vocabulary families, so the test measures generalization to
               new wordings rather than to unseen words. An out-of-vocabulary
               test set would mostly measure how much slang we failed to list.

  Determinism  every random choice goes through a seeded Random instance, so two
               runs produce byte-identical files.

Each row records the phrase it was built from, in `phrases`. ml/train.py uses
that to hold back whole phrases for validation, so the tuned threshold is
tuned against unseen wordings rather than unseen rows of seen wordings.

Labels are a list per row. An out-of-scope row carries an empty list: the
classifier is trained over the supported conditions only, and
"no condition above threshold" is what out_of_scope means at inference time
(see ml/train.py and hdi/classify.py).
"""

import argparse
import csv
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONDITIONS_CSV = ROOT / "data" / "reference" / "conditions.csv"
OUT_DIR = ROOT / "ml" / "data"

SEED = 20260401
TRAIN_PER_CONDITION = 190
MULTI_CONDITION_TRAIN = 90
OUT_OF_SCOPE_TRAIN = 380
TEST_PER_CLASS = 48
MULTI_CONDITION_TEST = 48

OUT_OF_SCOPE = "out_of_scope"

# ---------------------------------------------------------------------------
# Phrase pools. "train" and "test" share no string, but they do share
# vocabulary: both are ways a user might really name the same condition.
# ---------------------------------------------------------------------------

PHRASES = {
    "type_2_diabetes": {
        "train": [
            "my sugar is high",
            "high blood sugar",
            "blood sugar is high",
            "sugar badh gaya hai",
            "sugar bahut badh gaya",
            "diabetes",
            "type 2 diabetes",
            "type two diabetes",
            "diabetes mellitus",
            "sugar ki bimari",
            "shugar high hai",
            "shugar ki shikayat",
            "blood sugar is not under control",
            "sugar control nahi ho raha",
            "my fasting sugar is high",
            "fasting glucose high",
            "sugar problem",
            "sugar ki problem hai",
            "diabetic since many years",
            "diabetic for years now",
            "madhumeh",
            "madhumeh ki bimari",
            "sugar zyada aa raha hai",
            "sugar zyada rehta hai",
            "raised blood glucose",
            "glucose level high",
            "glucose high aa raha hai",
            "my hba1c is high",
            "hba1c 9 percent",
            "i am diabetic",
            "mujhe sugar hai",
            "mujhe diabetes hai",
            "blood sugar badha hua hai",
            "high sugar levels",
            "high sugar reading",
            "sugar reading 300",
            "sugar level 240 aata hai",
            "diagnosed with diabetes",
            "doctor said i am diabetic",
            "sugar wale patient",
            "post meal sugar high rehta hai",
            "after food sugar goes high",
            "sugar upar chala jata hai",
            "blood glucose keeps rising",
            "sugar kam nahi ho raha",
        ],
        "test": [
            "sugar reading is up",
            "mera sugar kaafi high rehta hai",
            "doctor said i have type two diabetes",
            "blood glucose keeps climbing",
            "shugar ki takleef hai",
            "my diabetes is poorly controlled",
            "sugar level 250 ke aas paas",
            "a diabetic for a decade",
            "high sugar in the morning",
            "madhumeh ki taqleef",
            "sugar bahut upar chala gaya",
            "glucose nahi control ho raha",
            "my fasting blood sugar came 180",
            "hba1c report high aayi hai",
            "sugar ki dikkat chal rahi hai",
            "blood sugar levels stay elevated",
        ],
    },
    "hypertension": {
        "train": [
            "my bp is high",
            "bp is high",
            "high blood pressure",
            "blood pressure is high",
            "bp badh gaya hai",
            "bp bahut badh gaya",
            "hypertension",
            "hyper tension",
            "blood pressure problem",
            "bp ki problem hai",
            "bp ki dikkat",
            "bp zyada rehta hai",
            "bp high rehta hai",
            "raised blood pressure",
            "blood pressure raised",
            "my blood pressure is not controlled",
            "blood pressure control nahi ho raha",
            "high bp",
            "high bp since years",
            "ucch raktchap",
            "raktchap badha hua hai",
            "mujhe bp hai",
            "mujhe high bp hai",
            "blood pressure badha hua hai",
            "bp high hai",
            "diagnosed with hypertension",
            "doctor said i have high bp",
            "bp 160 ke upar rehta hai",
            "bp 150 by 100 aata hai",
            "i am hypertensive",
            "pressure high rehta hai",
            "pressure upar rehta hai",
            "bp ki goli chal rahi hai",
            "upper bp bahut high aata hai",
            "systolic is high",
            "diastolic bhi high hai",
            "bp wale patient",
            "blood pressure reading high",
            "bp reading upar aata hai",
            "my pressure readings are high",
            "bp kam nahi ho raha",
            "bp upar chala jata hai",
            "blood pressure kaafi zyada hai",
            "bp ka level high hai",
        ],
        "test": [
            "bp reading came out high",
            "mera blood pressure kaafi upar hai",
            "doctor said my pressure is raised",
            "hyper tension ka patient hoon",
            "bp hamesha high side pe rehta hai",
            "my readings are consistently above normal",
            "raktchap zyada rehta hai",
            "bp ki shikayat chal rahi hai",
            "pressure ka level high aa raha hai",
            "i was told i have high bp",
            "blood pressure kaafi badh gaya",
            "bp 140 by 95 aata hai",
            "systolic reading stays elevated",
            "mujhe hypertension bataya gaya hai",
            "high blood pressure se pareshan",
            "bp control me nahi aa raha",
        ],
    },
    "heart_failure": {
        "train": [
            "heart failure",
            "cardiac failure",
            "congestive heart failure",
            "chronic heart failure",
            "my heart is weak",
            "heart is weak",
            "weak heart muscle",
            "dil kamzor ho gaya hai",
            "dil kamzor hai",
            "dil ki kamzori",
            "heart ki kamzori hai",
            "hriday ki kamzori",
            "heart pumping is low",
            "pumping kam hai",
            "dil ki pumping kam hai",
            "heart pump kamzor hai",
            "pumping capacity low hai",
            "low ejection fraction",
            "ejection fraction 30 percent",
            "ef is low",
            "ef only 35 percent",
            "heart function reduced",
            "heart function kam ho gaya",
            "doctor said heart is not pumping well",
            "dil theek se pump nahi kar raha",
            "swelling in my legs and feet",
            "swelling in legs",
            "legs swell up by evening",
            "ankles are swollen",
            "swollen feet and ankles",
            "paon me sujan rehti hai",
            "pairon me sujan aa jati hai",
            "tangon me sujan hai",
            "paon sooj jate hain",
            "fluid retention in legs",
            "water retention from the heart",
            "fluid build up in the legs",
            "tired after walking a little",
            "thoda chalne se thakan",
            "thakan rehti hai aur sujan bhi",
            "get tired on exertion",
            "heart failure ka patient hoon",
            "failing heart",
            "heart is not working properly",
            "dil ka pump kamzor pad gaya",
        ],
        "test": [
            "my cardiologist says the pump function has dropped",
            "dil theek se khoon pump nahi kar raha",
            "feet swell up every night",
            "my ef is only 32 percent",
            "hriday kamzor ho gaya bata rahe hain",
            "the heart muscle has become weak",
            "sujan dono tangon me aa jati hai",
            "i tire out very fast on walking",
            "reduced pumping capacity of the heart",
            "dil ka pumping bahut kam hai",
            "swollen ankles by the end of the day",
            "diagnosed with congestive cardiac failure",
            "ejection fraction report kam aayi",
            "pairon ki sujan badh rahi hai",
            "heart failure bataya gaya hai",
            "water is collecting in my legs",
        ],
    },
    "atrial_fibrillation": {
        "train": [
            "atrial fibrillation",
            "fibrillation",
            "afib",
            "a fib",
            "af",
            "irregular heartbeat",
            "irregular heart beat",
            "my heartbeat is irregular",
            "heartbeat is irregular",
            "dhadkan irregular hai",
            "dhadkan irregular ho jati hai",
            "palpitations",
            "palpitation hoti hai",
            "heart flutters",
            "fluttering feeling in the heart",
            "flutter in the upper heart",
            "dil ki dhadkan tez ho jati hai",
            "dhadkan tez ho jati hai",
            "dhadkan bahut tez chalti hai",
            "dhadkan ki problem hai",
            "dhadkan ki dikkat",
            "my pulse is irregular",
            "pulse is irregular",
            "pulse is not steady",
            "pulse count karna mushkil hai",
            "heart beats out of rhythm",
            "rhythm is irregular",
            "irregular rhythm on ecg",
            "ecg showed irregular rhythm",
            "heart rate goes up and down",
            "heart racing on and off",
            "dhadkan beech beech me ruk jati hai",
            "heartbeat skips",
            "beat skip ho jati hai",
            "diagnosed with atrial fibrillation",
            "doctor said my rhythm is irregular",
            "arrhythmia in the upper chambers",
            "upper chamber rhythm problem",
            "dil dhak dhak karta hai",
            "dil tez dhadakta hai",
            "irregular pulse on examination",
            "my beat is uneven",
            "dhadkan ka taal bigda hua hai",
            "heart rhythm disorder",
        ],
        "test": [
            "ecg showed an irregularly irregular pulse",
            "mera dil bahut irregular dhadakta hai",
            "the beat is all over the place",
            "a fib ka diagnosis hua hai",
            "dhadkan ekdum uljhi hui chalti hai",
            "my rhythm is erratic",
            "dhadkan kabhi tez kabhi dheemi",
            "upper chamber rhythm disorder bataya",
            "i can feel my heart stumbling",
            "pulse itna irregular hai ki ginna mushkil",
            "flutter mehsoos hota hai dil me",
            "atrial fibrillation bataya gaya hai",
            "heart rate irregular rehta hai",
            "dil ki dhadkan beqaabu hai",
            "palpitations keep coming and going",
            "ecg me rhythm irregular nikla",
        ],
    },
    "venous_thromboembolism": {
        "train": [
            "blood clot in my leg",
            "blood clot",
            "clot in the leg",
            "clot in the vein",
            "clot in the calf",
            "leg vein clot",
            "deep vein clot in the thigh",
            "deep vein thrombosis",
            "dvt",
            "venous thrombosis",
            "thrombosis",
            "pulmonary embolism",
            "embolism in the lung",
            "clot went to my lung",
            "clot in the lungs",
            "khoon ka thakka ban gaya",
            "khoon ka thakka",
            "thakka jam gaya hai",
            "nas me thakka jam gaya",
            "nas me khoon jam gaya",
            "taang ki nas me thakka",
            "pindli me thakka",
            "clotting problem",
            "clotting disorder",
            "thakka banne ki problem",
            "khoon jamne ki problem",
            "a clot last month",
            "doctor found a clot",
            "clot mila hai scan me",
            "recurrent clots",
            "clots keep forming",
            "khoon ke thakke bante hain",
            "clot prevention",
            "clot se bachna hai",
            "swollen painful calf from a clot",
            "taang sooj gayi thakke se",
            "leg pain and swelling from a clot",
            "blocked vein from a clot",
            "doppler showed a clot",
            "thrombus in the vein",
            "clot ka ilaj chal raha hai",
            "blood clot ki bimari",
            "vein blockage from clotted blood",
            "lung me clot chala gaya",
        ],
        "test": [
            "a thrombus was seen on the doppler scan",
            "pindli ki nas me khoon jam gaya",
            "they found a blockage in a deep vein",
            "lung me clot pahunch gaya tha",
            "venous blockage from clotted blood",
            "mujhe clot ki dikkat hai",
            "thakka banne ka khatra bataya hai",
            "the scan showed a clot in my leg vein",
            "thakke ki wajah se taang sooj gayi",
            "embolism in the pulmonary artery",
            "khoon ke thakke bante rehte hain",
            "a clot was picked up in my calf",
            "deep vein thrombosis ka diagnosis",
            "nas me jama hua khoon",
            "clot ki wajah se dard hai",
            "pulmonary clot ka history hai",
        ],
    },
    "secondary_cardiovascular_prevention": {
        "train": [
            "a heart attack last year",
            "an earlier heart attack",
            "after my heart attack",
            "post heart attack",
            "heart attack ke baad",
            "heart attack ho chuka hai",
            "mujhe heart attack aa chuka hai",
            "dil ka daura pad chuka hai",
            "dil ka dauraa aaya tha",
            "a stent in my artery",
            "stent dala hua hai",
            "stent ke baad",
            "stent lag chuka hai",
            "two stents in my arteries",
            "after angioplasty",
            "angioplasty ho chuki hai",
            "angioplasty karwayi thi",
            "after my bypass surgery",
            "bypass ke baad",
            "bypass surgery ho chuki hai",
            "heart ki bypass hui thi",
            "cabg done",
            "previous myocardial infarction",
            "an old mi on record",
            "old infarct on my report",
            "my heart attack was in 2019",
            "coronary artery disease",
            "artery blockage in the heart",
            "had a stroke two years ago",
            "stroke ho chuka hai",
            "stroke ke baad se dawa chal rahi hai",
            "brain stroke aaya tha",
            "i want to prevent another heart attack",
            "dusra attack nahi chahiye",
            "prevent a repeat heart attack",
            "secondary prevention for my heart",
            "prevention after a cardiac event",
            "blood thinner for my heart",
            "i am on a blood thinner since my heart attack",
            "doctor said to prevent a repeat attack",
            "dil ka daura dobara na ho",
            "cardiac event ke baad ki dawa",
            "heart attack ke baad prevention",
            "post cardiac event follow up",
        ],
        "test": [
            "my heart attack happened three years back",
            "mujhe pehle heart attack aa chuka hai",
            "they put two stents in my heart arteries",
            "cabg bypass kara chuka hoon",
            "dil ka dauraa pehle pad gaya tha",
            "i am on prevention therapy after a cardiac event",
            "angioplasty karwa ke ghar aaya tha",
            "a previous infarct is on my record",
            "brain stroke ho chuka tha mujhe",
            "want to avoid a repeat heart attack",
            "stent lagne ke baad dawa chalu hai",
            "post infarct follow up chal raha hai",
            "coronary blockage ka ilaj hua tha",
            "heart attack se bach gaya tha",
            "stroke hone ke baad dawa shuru hui",
            "my cardiac event was two years ago",
        ],
    },
}

# ---------------------------------------------------------------------------
# Out-of-scope pools. Everything a user might plausibly type that none of the
# 13 drugs or 3 drug classes is used for.
# ---------------------------------------------------------------------------

OUT_OF_SCOPE_PHRASES = {
    "train": [
        "a headache",
        "sir dard ho raha hai",
        "migraine",
        "half head pain",
        "bad cough",
        "khansi ho rahi hai",
        "dry cough for a week",
        "cold and blocked nose",
        "zukam aur nak band",
        "naak beh rahi hai",
        "sore throat",
        "gale me kharash",
        "gale me dard",
        "fever since two days",
        "bukhar aa raha hai",
        "acidity and heartburn",
        "pet me jalan",
        "khatti dakar",
        "gas and bloating",
        "pet phool jata hai",
        "constipation",
        "kabz ki problem",
        "pet saaf nahi hota",
        "loose motions",
        "dast lag gaye hain",
        "stomach pain",
        "pet dard",
        "vomiting since morning",
        "ulti ho rahi hai",
        "nausea after eating",
        "skin rash on my arms",
        "khujli ho rahi hai",
        "itchy skin",
        "pimples on my face",
        "muhase nikal rahe hain",
        "eczema patches",
        "dandruff",
        "rusi ki problem",
        "hair fall",
        "baal jhad rahe hain",
        "baal patle ho gaye",
        "joint pain in my knees",
        "ghutno me dard",
        "back pain",
        "kamar dard",
        "neck stiffness",
        "gardan me akdan",
        "shoulder pain",
        "kandhe me dard",
        "toothache",
        "dant me dard",
        "mouth ulcers",
        "muh me chhale",
        "bleeding gums",
        "cannot sleep at night",
        "neend nahi aa rahi",
        "feeling anxious all the time",
        "ghabrahat hoti hai",
        "feeling low and tired",
        "bahut thakan rehti hai",
        "weight gain",
        "mota ho raha hoon",
        "want to lose weight",
        "wazan kam karna hai",
        "piles problem",
        "bawaseer ki dikkat",
        "burning while passing urine",
        "peshab me jalan",
        "frequent urination at night",
        "irregular periods",
        "periods time pe nahi aate",
        "period cramps",
        "mahavari me dard",
        "dust allergy",
        "sneezing in the morning",
        "chheenk aati rehti hai",
        "eye strain from the screen",
        "aankhon me jalan",
        "dark circles",
        "thyroid problem",
        "thyroid ki report kharab",
        "nails are brittle",
        "cracked heels",
        "bad breath",
        "muh se badbu aati hai",
        "foot fungus",
        "ear pain",
        "kaan me dard",
        "ringing in my ears",
        "hiccups that will not stop",
        "motion sickness in the car",
        "sunburn",
        "mosquito bite swelling",
        "a boil on my leg",
        "wisdom tooth swelling",
        "snoring at night",
        "white patches on skin",
        "cramp in my calf at night",
        "sinus problem",
        "dry mouth",
        # Vague messages that name no condition at all.
        #
        # Without these the model drifts towards its intercept whenever a text
        # carries no condition signal, and a balanced one-vs-rest intercept sits
        # near zero -- so "i have a cough" came out above threshold for a
        # cardiac class purely on the shared template words. These rows teach
        # the templates themselves to be neutral.
        "not feeling well",
        "feeling unwell",
        "kuch theek nahi lag raha",
        "tabiyat theek nahi hai",
        "something is wrong with me",
        "i need some advice",
        "mujhe salah chahiye",
        "a general health question",
        "just a general question",
        "i want a checkup",
        "general checkup karwana hai",
        "my health in general",
        "nothing specific",
        "kuch khaas nahi",
        "mujhe kuch pata nahi",
        "i am not sure what is wrong",
        "some health problem",
        "koi health problem hai",
        "i feel off today",
        "aaj thoda alag lag raha hai",
        "body is not right",
        "sharir theek nahi lag raha",
        "want to stay healthy",
        "swasth rehna hai",
        "general wellness",
        "some symptoms",
        "kuch lakshan hain",
        "asking for a friend",
        "ek dost ke liye puch raha hoon",
        "random question",
    ],
    "test": [
        "my head has been throbbing since morning",
        "aadha sir dard kar raha hai",
        "a tickle in my throat makes me cough",
        "naak band rehti hai subah subah",
        "temperature touched 101 yesterday",
        "khatti dakar aati rehti hai",
        "my bowels have not moved in three days",
        "pet theek se saaf nahi ho raha",
        "feeling sick after every meal",
        "red itchy patches behind my knees",
        "chehre pe daane nikal aaye",
        "scalp is flaking badly",
        "baalon ki jaden kamzor lag rahi hain",
        "knee creaks and hurts on stairs",
        "lower back is locking up",
        "a molar is sensitive to cold water",
        "jeebh pe chhala ho gaya",
        "i lie awake till three in the night",
        "mann bechain rehta hai",
        "put on five kilos this year",
        "pile mass comes out on straining",
        "peshab karte waqt dard hota hai",
        "cycle is thirty five days long now",
        "chheenkte chheenkte haalat kharab",
        "eyes water after screen work",
        "palkein bhaari lagti hain",
        "thyroid ki jaanch kharab aayi",
        "heels have deep cracks",
        "ear feels blocked and painful",
        "kaan me seeti ki awaaz",
        "hichki band nahi ho rahi",
        "feel queasy on long drives",
        "skin peeled after a day in the sun",
        "a painful lump under my arm",
        "mere kandhe me akdan hai",
        "pindli me raat ko bal pad jaata hai",
        "white spots spreading on my hand",
        "nakhoon tootte ja rahe hain",
        "muh ka swad chala gaya",
        "sore gums that bleed on brushing",
        "sinus pressure behind my eyes",
        "a stye on my eyelid",
        "fungus between my toes",
        "jaw clicks when i chew",
        "hay fever every spring",
        "chapped lips in winter",
        "a wart on my finger",
        "gale me khich khich hai",
        # Vague messages naming no condition, as in the training pool.
        "i am just not right these days",
        "sehat theek nahi chal rahi",
        "no particular complaint",
        "koi pakki shikayat nahi hai",
        "i would like general guidance",
        "aam taur pe jaankari chahiye",
        "unsure what my problem is",
        "pata nahi kya dikkat hai",
        "wanted to ask something general",
        "mujhe ek aam sawal puchna hai",
        "health ke baare me jaanna hai",
        "feeling a bit strange lately",
    ],
}

# ---------------------------------------------------------------------------
# Templates. {p} takes a condition phrase. Train and test template sets are
# disjoint; neither carries a condition cue of its own.
# ---------------------------------------------------------------------------

TRAIN_TEMPLATES = [
    "{p}",
    "{p}, what are my options",
    "i have {p}",
    "mujhe {p}",
    "{p} ke liye kya le sakta hoon",
    "doctor says {p}",
    "{p} - any ayurvedic option",
    "what can i take for {p}",
    "{p}, please suggest something",
    "{p} and i want to know the options",
    "help me with {p}",
    "{p} ka ilaj kya hai",
    "i am worried about {p}",
    "{p}, is there a herbal choice",
    "my problem is {p}",
    "{p} ke liye koi dawa batao",
    "suffering from {p}",
    "{p} se pareshan hoon",
]

TEST_TEMPLATES = [
    "{p} — what should i consider",
    "regarding {p}, give me the choices",
    "{p} hai mera, kya kiya ja sakta hai",
    "could you list options for {p}",
    "been dealing with {p} for a while",
    "{p}; looking for information",
    "any suggestions given {p}",
    "{p} ko lekar salah chahiye",
    "i would like to understand {p} better",
    "{p} ki wajah se chinta ho rahi hai",
]

MULTI_CONNECTORS_TRAIN = [
    "{a} and {b}",
    "{a} aur {b} dono",
    "{a}, also {b}",
    "i have {a} and {b}",
    "{a} ke saath {b} bhi hai",
    "both {a} and {b}",
    "{a} plus {b}",
    "mujhe {a} aur {b} dono hain",
]

MULTI_CONNECTORS_TEST = [
    "{a} as well as {b}",
    "{a} ke alawa {b} bhi chal raha hai",
    "two things: {a}, and {b}",
    "{a} tatha {b}",
    "alongside {a} i also have {b}",
    "{a} hai aur sath me {b} bhi",
]


def apply_typo(text, rng):
    """One deterministic, human-looking typo: swap, drop, double or miss a space.

    Applied to a slice of the data so the vectorizer meets misspellings during
    training rather than only at request time.
    """
    words = text.split(" ")
    candidates = [i for i, w in enumerate(words) if len(w) > 3]
    if not candidates:
        return text
    i = rng.choice(candidates)
    word = words[i]
    kind = rng.choice(("swap", "drop", "double", "nospace"))
    j = rng.randrange(1, len(word) - 1)
    if kind == "swap":
        word = word[:j] + word[j + 1] + word[j] + word[j + 2:]
    elif kind == "drop":
        word = word[:j] + word[j + 1:]
    elif kind == "double":
        word = word[:j] + word[j] + word[j:]
    words[i] = word
    if kind == "nospace" and i + 1 < len(words):
        words[i: i + 2] = [words[i] + words[i + 1]]
    return " ".join(words)


def load_condition_ids():
    with open(CONDITIONS_CSV, newline="", encoding="utf-8") as f:
        return [row["condition_id"] for row in csv.DictReader(f)]


def duplicates_frame(template, phrase):
    """Whether a template would repeat a frame the phrase already opens with.

    "i have {p}" over "a stent in my artery" is fine; over a phrase starting
    "i have" it renders "i have i have ...", and that duplicated opener becomes
    a feature of whichever class owns the phrase rather than staying neutral
    across all of them. Dropping the combination keeps both the template and the
    phrase, which are each realistic on their own.
    """
    prefix = template.split("{p}")[0]
    return bool(prefix) and phrase.lower().startswith(prefix.lower())


def generate(split, condition_ids, rng, per_condition, multi_n, oos_n, templates,
             connectors, typo_rate):
    """One split: single-condition rows, multi-condition rows, out-of-scope rows."""
    rows = []

    for condition_id in condition_ids:
        pool = PHRASES[condition_id][split]
        combos = [
            (p, t) for p in pool for t in templates if not duplicates_frame(t, p)
        ]
        rng.shuffle(combos)
        for phrase, template in combos[:per_condition]:
            text = template.format(p=phrase)
            if rng.random() < typo_rate:
                text = apply_typo(text, rng)
            rows.append({"text": text, "labels": [condition_id], "phrases": [phrase]})

    pairs = [(a, b) for i, a in enumerate(condition_ids) for b in condition_ids[i + 1:]]
    combos = [
        (a, b, pa, pb, c)
        for a, b in pairs
        for pa in PHRASES[a][split]
        for pb in PHRASES[b][split]
        for c in connectors
    ]
    rng.shuffle(combos)
    for a, b, pa, pb, connector in combos[:multi_n]:
        text = connector.format(a=pa, b=pb)
        if rng.random() < typo_rate:
            text = apply_typo(text, rng)
        rows.append({"text": text, "labels": sorted([a, b]), "phrases": sorted([pa, pb])})

    oos_pool = OUT_OF_SCOPE_PHRASES[split]
    combos = [
        (p, t) for p in oos_pool for t in templates if not duplicates_frame(t, p)
    ]
    rng.shuffle(combos)
    for phrase, template in combos[:oos_n]:
        text = template.format(p=phrase)
        if rng.random() < typo_rate:
            text = apply_typo(text, rng)
        rows.append({"text": text, "labels": [], "phrases": [phrase]})

    return rows


def dedupe(rows):
    """Keep the first row for each text; duplicates would inflate a score."""
    seen, kept = set(), []
    for row in rows:
        if row["text"] in seen:
            continue
        seen.add(row["text"])
        kept.append(row)
    return kept


def phrase_pools():
    """All phrase strings per split, for the disjointness check."""
    pools = {"train": set(), "test": set()}
    for split in pools:
        for condition in PHRASES.values():
            pools[split].update(condition[split])
        pools[split].update(OUT_OF_SCOPE_PHRASES[split])
    return pools


def build():
    condition_ids = load_condition_ids()
    missing = [c for c in condition_ids if c not in PHRASES]
    if missing:
        raise SystemExit(
            f"conditions.csv has conditions with no phrase pool: {missing}. "
            f"Add wordings to ml/make_dataset.py before training."
        )

    pools = phrase_pools()
    shared = pools["train"] & pools["test"]
    if shared:
        raise SystemExit(f"phrase pools overlap, which would leak: {sorted(shared)}")
    shared_templates = set(TRAIN_TEMPLATES) & set(TEST_TEMPLATES)
    if shared_templates:
        raise SystemExit(f"template sets overlap: {sorted(shared_templates)}")
    rng = random.Random(SEED)
    train = dedupe(generate(
        "train", condition_ids, rng,
        per_condition=TRAIN_PER_CONDITION, multi_n=MULTI_CONDITION_TRAIN,
        oos_n=OUT_OF_SCOPE_TRAIN, templates=TRAIN_TEMPLATES,
        connectors=MULTI_CONNECTORS_TRAIN, typo_rate=0.18,
    ))

    # A second Random, seeded separately, so changing the training size does
    # not reshuffle the test set.
    rng_test = random.Random(SEED + 1)
    test = dedupe(generate(
        "test", condition_ids, rng_test,
        per_condition=TEST_PER_CLASS, multi_n=MULTI_CONDITION_TEST,
        oos_n=TEST_PER_CLASS, templates=TEST_TEMPLATES,
        connectors=MULTI_CONNECTORS_TEST, typo_rate=0.18,
    ))

    train_texts = {r["text"] for r in train}
    test = [r for r in test if r["text"] not in train_texts]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train.jsonl", train), ("test.jsonl", test)):
        path = OUT_DIR / name
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        print(f"{path.relative_to(ROOT)}: {len(rows)} rows")

    def counts(rows):
        per = {c: 0 for c in condition_ids}
        per[OUT_OF_SCOPE] = 0
        multi = 0
        for row in rows:
            if not row["labels"]:
                per[OUT_OF_SCOPE] += 1
            else:
                for label in row["labels"]:
                    per[label] += 1
                if len(row["labels"]) > 1:
                    multi += 1
        return per, multi

    for name, rows in (("train", train), ("test", test)):
        per, multi = counts(rows)
        print(f"\n{name}: {len(rows)} rows, {multi} multi-condition")
        for label, n in per.items():
            print(f"  {label}: {n}")

    overlap = train_texts & {r["text"] for r in test}
    print(f"\nidentical strings shared between train and test: {len(overlap)}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    return build()


if __name__ == "__main__":
    sys.exit(main())
