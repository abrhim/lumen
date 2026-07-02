import React, { useState, useMemo, useEffect, useRef } from "react";
import * as d3 from "d3";

/* ───────────────────────────────────────────────────────────────────────────
   LUMEN · Study surface v3  (desktop three-pane)
   [ Study pane: chapter summary + themes + roll-up ] · [ Reading column ] ·
   [ Tabbed rail: Connections (canon + Conference) | Notes (stubbed) ]
   Canon data real (1 Nephi 3). Summary node real. GC layer real citations.
   Notes are session-memory stubs — window.storage wiring makes them durable.
─────────────────────────────────────────────────────────────────────────── */

const CHAPTER = {
  book: "1 Nephi", chapter: 3, ref: "1 Nephi 3",
  subtitle: "The brass plates — Lehi sends his sons back to Jerusalem to obtain the record of Laban",
  summary: {
    text: "Lehi receives a divine command in a dream for his sons to return to Jerusalem and retrieve the brass plates from Laban, which contain scripture and genealogical records essential for their posterity. While Laman and Lemuel murmur at the difficulty of the errand, Nephi famously declares his willingness to obey, expressing his conviction that God always prepares a way to accomplish His commandments. Two attempts to obtain the plates fail — first through direct request, then through an offer of the family's wealth — with Laban responding violently both times, ultimately coveting and seizing their riches. Beaten by their elder brothers in the wilderness, Nephi and Sam receive a visit from an angel who rebukes Laman and Lemuel and promises that the Lord will deliver Laban into their hands — yet even this angelic witness fails to permanently soften the older brothers, who immediately resume their doubting.",
    themes: ["Obedience despite difficulty","Preservation of scripture","Murmuring versus faithfulness","Angelic rebuke and hardness of heart","Divine preparation for commandments"],
    principles:[{id:"record-keeping",name:"Record Keeping & Scripture"},{id:"revelation",name:"Revelation"},{id:"faith",name:"Faith"},{id:"obedience",name:"Obedience"},{id:"murmuring",name:"Murmuring"},{id:"hardness-of-heart",name:"Hardness of Heart"},{id:"angels",name:"Angels"}],
    people:[{id:"nephi-1",name:"Nephi"},{id:"lehi-1",name:"Lehi"},{id:"laban-1",name:"Laban"},{id:"sam-1",name:"Sam"},{id:"laman-1",name:"Laman"},{id:"lemuel-1",name:"Lemuel"}],
    places:[{id:"jerusalem",name:"Jerusalem"},{id:"wilderness",name:"The Wilderness"}],
  },
  verses: [
    { n:1, t:"And it came to pass that I, Nephi, returned from speaking with the Lord, to the tent of my father.", pr:[{id:"personal-revelation",name:"Personal Revelation"}], pe:[{id:"nephi-1",name:"Nephi"},{id:"lehi-1",name:"Lehi"}], pl:[{id:"tent-of-lehi",name:"Tent of Lehi"}], o:["1-ne-2-15","1-ne-2-19","1-ne-3-2"], i:[] },
    { n:2, t:"And it came to pass that he spake unto me, saying: Behold I have dreamed a dream, in the which the Lord hath commanded me that thou and thy brethren shall return to Jerusalem.", pr:[], pe:[{id:"lehi-1",name:"Lehi"}], pl:[{id:"jerusalem",name:"Jerusalem"}], o:["1-ne-2-2","gen-31-11","gen-37-5"], i:["1-ne-3-1","1-ne-5-6","1-ne-7-2"] },
    { n:3, t:"For behold, Laban hath the record of the Jews and also a genealogy of my forefathers, and they are engraven upon plates of brass.", pr:[{id:"record-keeping",name:"Record Keeping & Scripture"}], pe:[{id:"laban-1",name:"Laban"}], pl:[], o:["1-ne-4-16","1-ne-5-11","1-ne-5-14","2-kgs-22-8","gen-24-29","jer-17-1"], i:["1-ne-3-12","1-ne-3-24","1-ne-4-16","1-ne-4-24","1-ne-4-38","1-ne-5-16","1-ne-5-19","2-ne-5-12","3-ne-23-7","gen-24-29","jer-17-1","mosiah-1-4","mosiah-10-16"] },
    { n:4, t:"Wherefore, the Lord hath commanded me that thou and thy brothers should go unto the house of Laban, and seek the records, and bring them down hither into the wilderness.", pr:[], pe:[{id:"lehi-1",name:"Lehi"},{id:"laban-1",name:"Laban"}], pl:[{id:"wilderness",name:"The Wilderness"}], o:["1-ne-3-7","1-ne-4-1"], i:["1-ne-4-38","1-ne-7-3"] },
    { n:5, t:"And now, behold thy brothers murmur, saying it is a hard thing which I have required of them; but behold I have not required it of them, but it is a commandment of the Lord.", pr:[{id:"obedience",name:"Obedience"},{id:"murmuring",name:"Murmuring"}], pe:[], pl:[], o:["1-ne-2-11","2-kgs-2-10","ex-16-2","ex-16-8","num-16-41"], i:["1-ne-7-7","2-kgs-2-10"] },
    { n:6, t:"Therefore go, my son, and thou shalt be favored of the Lord, because thou hast not murmured.", pr:[{id:"murmuring",name:"Murmuring"}], pe:[], pl:[], o:["1-ne-2-16","1-ne-2-19","num-14-24"], i:[] },
    { n:7, t:"And it came to pass that I, Nephi, said unto my father: I will go and do the things which the Lord hath commanded, for I know that the Lord giveth no commandments unto the children of men, save he shall prepare a way for them that they may accomplish the thing which he commandeth them.", pr:[{id:"obedience",name:"Obedience"}], pe:[{id:"nephi-1",name:"Nephi"},{id:"lehi-1",name:"Lehi"}], pl:[], o:["1-cor-10-13","1-kgs-17-15","1-ne-17-3","1-ne-4-1","1-sam-17-32","deut-31-8","gen-18-14","mosiah-2-41","philip-4-13"], i:["1-kgs-17-13","1-kgs-17-15","1-kgs-17-5","1-ne-16-18","1-ne-16-8","1-ne-17-10","1-ne-17-13","1-ne-17-3","1-ne-17-49","1-ne-2-3","1-ne-3-15","1-ne-3-26","1-ne-3-4","1-ne-4-34","1-ne-4-6","1-ne-5-20","1-ne-5-8","1-ne-7-12","1-ne-9-6","1-sam-17-32","2-ne-1-24","2-ne-1-28","2-ne-4-24","2-ne-5-31","3-ne-13-25","acts-26-19","acts-27-25","alma-17-11","alma-19-23","alma-20-2","alma-26-27","alma-27-7","alma-31-33","alma-46-20","alma-60-34","alma-61-13","dc-1-38","dc-1-5","dc-3-1","dc-3-8","dc-5-34","deut-30-8","eccl-12-13","ether-12-6","ether-2-22","ex-12-28","ex-14-15","ex-18-25","ex-3-10","gen-18-14","gen-39-3","gen-7-5","hel-9-37","isa-6-8","matt-21-6","matt-25-4","mosiah-10-13","mosiah-28-7","philip-4-13","ps-37-5"] },
    { n:8, t:"And it came to pass that when my father had heard these words he was exceedingly glad, for he knew that I had been blessed of the Lord.", pr:[], pe:[{id:"nephi-1",name:"Nephi"},{id:"lehi-1",name:"Lehi"}], pl:[], o:["1-ne-1-1","1-ne-2-16","gen-27-27","ps-115-15"], i:["ps-115-15"] },
    { n:9, t:"And I, Nephi, and my brethren took our journey in the wilderness, with our tents, to go up to the land of Jerusalem.", pr:[{id:"obedience",name:"Obedience"}], pe:[{id:"nephi-1",name:"Nephi"}], pl:[{id:"jerusalem",name:"Jerusalem"},{id:"wilderness",name:"The Wilderness"},{id:"land-of-jerusalem",name:"Land of Jerusalem"}], o:["1-ne-2-4","gen-12-1","num-33-8"], i:["1-ne-7-3","num-33-8"] },
    { n:10, t:"And it came to pass that when we had gone up to the land of Jerusalem, I and my brethren did consult one with another.", pr:[], pe:[{id:"nephi-1",name:"Nephi"}], pl:[{id:"jerusalem",name:"Jerusalem"},{id:"land-of-jerusalem",name:"Land of Jerusalem"}], o:["1-ne-3-19"], i:[] },
    { n:11, t:"And we cast lots--who of us should go in unto the house of Laban. And it came to pass that the lot fell upon Laman; and Laman went in unto the house of Laban, and he talked with him as he sat in his house.", pr:[{id:"record-keeping",name:"Record Keeping & Scripture"}], pe:[{id:"laban-1",name:"Laban"},{id:"laman-1",name:"Laman"}], pl:[], o:["1-sam-14-42","acts-1-26","josh-18-10","neh-10-34"], i:["1-ne-7-4","acts-1-26","neh-10-34"] },
    { n:12, t:"And he desired of Laban the records which were engraven upon the plates of brass, which contained the genealogy of my father.", pr:[], pe:[{id:"lehi-1",name:"Lehi"},{id:"laban-1",name:"Laban"}], pl:[], o:["1-kgs-7-30","1-ne-3-3","1-ne-5-14","mosiah-1-4"], i:["1-kgs-7-30"] },
    { n:13, t:"And behold, it came to pass that Laban was angry, and thrust him out from his presence; and he would not that he should have the records. Wherefore, he said unto him: Behold thou art a robber, and I will slay thee.", pr:[{id:"hardness-of-heart",name:"Hardness of Heart"}], pe:[{id:"laban-1",name:"Laban"},{id:"laman-1",name:"Laman"}], pl:[], o:["1-ne-3-25","1-ne-4-1","1-ne-4-11","gen-27-43"], i:["gen-27-43"] },
    { n:14, t:"But Laman fled out of his presence, and told the things which Laban had done, unto us. And we began to be exceedingly sorrowful, and my brethren were about to return unto my father in the wilderness.", pr:[{id:"murmuring",name:"Murmuring"}], pe:[{id:"nephi-1",name:"Nephi"},{id:"lehi-1",name:"Lehi"},{id:"laban-1",name:"Laban"},{id:"laman-1",name:"Laman"}], pl:[{id:"wilderness",name:"The Wilderness"}], o:["1-ne-3-26"], i:["1-ne-4-28","1-ne-7-4","alma-54-19","ps-5-2"] },
    { n:15, t:"But behold I said unto them that: As the Lord liveth, and as we live, we will not go down unto our father in the wilderness until we have accomplished the thing which the Lord hath commanded us.", pr:[{id:"endure-to-end",name:"Endure to the End"}], pe:[{id:"nephi-1",name:"Nephi"}], pl:[{id:"wilderness",name:"The Wilderness"}], o:["1-ne-3-7","1-sam-14-39","1-sam-20-3","josh-14-12","ruth-3-13"], i:["1-ne-4-1","1-sam-14-39"] },
    { n:16, t:"Wherefore, let us be faithful in keeping the commandments of the Lord; therefore let us go down to the land of our father's inheritance, for behold he left gold and silver, and all manner of riches. And all this he hath done because of the commandments of the Lord.", pr:[], pe:[{id:"lehi-1",name:"Lehi"}], pl:[{id:"land-of-fathers-inheritance",name:"Land of Inheritance"}], o:["1-ne-2-4","1-ne-3-22","1-ne-3-24","matt-19-21","rev-14-12"], i:["alma-27-13","rev-14-12"] },
    { n:17, t:"For he knew that Jerusalem must be destroyed, because of the wickedness of the people.", pr:[], pe:[], pl:[{id:"jerusalem",name:"Jerusalem"}], o:["1-ne-1-4","2-chr-36-20","2-kgs-25-9","2-ne-25-10","hel-8-20","jer-25-9","jer-26-18","jer-39-9"], i:["2-chr-36-20","jer-39-9"] },
    { n:18, t:"For behold, they have rejected the words of the prophets. Wherefore, if my father should dwell in the land after he hath been commanded to flee out of the land, behold, he would also perish. Wherefore, it must needs be that he flee out of the land.", pr:[], pe:[{id:"lehi-1",name:"Lehi"}], pl:[{id:"jerusalem",name:"Jerusalem"}], o:["1-ne-1-20","1-ne-2-1","2-chr-36-16","dc-1-14","jer-25-4","jer-26-20","jer-26-23"], i:["jer-26-23"] },
    { n:19, t:"And behold, it is wisdom in God that we should obtain these records, that we may preserve unto our children the language of our fathers;", pr:[], pe:[], pl:[], o:["1-ne-4-15","1-ne-5-21","mosiah-1-4","omni-1-17"], i:["1-ne-1-2","1-ne-3-10","dc-3-19","mosiah-1-3","mosiah-24-6","omni-1-18","ps-12-6"] },
    { n:20, t:"And also that we may preserve unto them the words which have been spoken by the mouth of all the holy prophets, which have been delivered unto them by the Spirit and power of God, since the world began, even down unto this present time.", pr:[], pe:[], pl:[], o:["1-ne-5-13","2-ne-3-20","2-pet-1-21","2-tim-3-16","acts-3-21","luke-1-70","matt-11-13","zech-7-12"], i:["acts-3-21","ether-8-26","luke-1-70","matt-11-13","zech-7-12"] },
    { n:21, t:"And it came to pass that after this manner of language did I persuade my brethren, that they might be faithful in keeping the commandments of God.", pr:[{id:"obedience",name:"Obedience"}], pe:[{id:"nephi-1",name:"Nephi"}], pl:[], o:["1-ne-2-16","1-ne-7-8","rev-14-12"], i:["rev-14-12"] },
    { n:22, t:"And it came to pass that we went down to the land of our inheritance, and we did gather together our gold, and our silver, and our precious things.", pr:[], pe:[], pl:[{id:"land-of-fathers-inheritance",name:"Land of Inheritance"}], o:["1-ne-2-4","num-32-32"], i:["1-ne-3-16","num-32-32"] },
    { n:23, t:"And after we had gathered these things together, we went up again unto the house of Laban.", pr:[], pe:[{id:"laban-1",name:"Laban"}], pl:[], o:[], i:["1-ne-4-5"] },
    { n:24, t:"And it came to pass that we went in unto Laban, and desired him that he would give unto us the records which were engraven upon the plates of brass, for which we would give unto him our gold, and our silver, and all our precious things.", pr:[], pe:[{id:"laban-1",name:"Laban"}], pl:[], o:["1-kgs-7-30","1-ne-3-3","1-ne-4-13","1-ne-5-14","2-cor-3-7","prov-23-23"], i:["1-kgs-7-30","1-ne-3-16","2-cor-3-7"] },
    { n:25, t:"And it came to pass that when Laban saw our property, and that it was exceedingly great, he did lust after it, insomuch that he thrust us out, and sent his servants to slay us, that he might obtain our property.", pr:[], pe:[{id:"laban-1",name:"Laban"}], pl:[], o:["1-kgs-21-13","1-tim-6-10","2-sam-11-2","jacob-2-17","mosiah-29-36"], i:["1-kgs-21-13","1-ne-3-13","1-ne-4-28"] },
    { n:26, t:"And it came to pass that we did flee before the servants of Laban, and we were obliged to leave behind our property, and it fell into the hands of Laban.", pr:[], pe:[{id:"laban-1",name:"Laban"}], pl:[], o:["1-ne-3-7","gen-27-43","matt-10-23"], i:["1-ne-3-14","gen-27-43"] },
    { n:27, t:"And it came to pass that we fled into the wilderness, and the servants of Laban did not overtake us, and we hid ourselves in the cavity of a rock.", pr:[{id:"divine-protection",name:"Divine Protection"}], pe:[], pl:[{id:"wilderness",name:"The Wilderness"}], o:["1-sam-13-6","1-sam-24-3","alma-14-29","jer-36-26","josh-10-16"], i:["jer-36-26","josh-10-16"] },
    { n:28, t:"And it came to pass that Laman was angry with me, and also with my father; and also was Lemuel, for he hearkened unto the words of Laman. Wherefore Laman and Lemuel did speak many hard words unto us, their younger brothers, and they did smite us even with a rod.", pr:[{id:"murmuring",name:"Murmuring"},{id:"hardness-of-heart",name:"Hardness of Heart"}], pe:[{id:"nephi-1",name:"Nephi"},{id:"lehi-1",name:"Lehi"},{id:"laman-1",name:"Laman"},{id:"lemuel-1",name:"Lemuel"}], pl:[], o:["1-ne-2-12","2-ne-5-3","ex-2-11","gen-37-4","gen-37-8"], i:["1-ne-7-16","1-ne-7-20","1-ne-7-6","2-ne-4-13","alma-18-38"] },
    { n:29, t:"And it came to pass as they smote us with a rod, behold, an angel of the Lord came and stood before them, and he spake unto them, saying: Why do ye smite your younger brother with a rod? Know ye not that the Lord hath chosen him to be a ruler over you, and this because of your iniquities? Behold ye shall go up to Jerusalem again, and the Lord will deliver Laban into your hands.", pr:[], pe:[{id:"nephi-1",name:"Nephi"},{id:"laban-1",name:"Laban"},{id:"laman-1",name:"Laman"},{id:"lemuel-1",name:"Lemuel"}], pl:[{id:"jerusalem",name:"Jerusalem"}], o:["1-ne-2-22","1-ne-4-1","2-kgs-3-18","acts-5-38","acts-7-35","gen-37-10","gen-37-8","gen-41-43","gen-44-6","num-22-31"], i:["1-ne-17-45","1-ne-18-11","1-ne-4-17","1-ne-4-3","1-ne-5-5","1-ne-5-8","1-ne-7-10","2-kgs-3-18","alma-9-6","dc-5-33","ether-8-3","gen-41-43","gen-44-6","hel-16-7"] },
    { n:30, t:"And after the angel had spoken unto us, he departed.", pr:[], pe:[], pl:[], o:["john-12-29"], i:["john-12-29"] },
    { n:31, t:"And after the angel had departed, Laman and Lemuel again began to murmur, saying: How is it possible that the Lord will deliver Laban into our hands? Behold, he is a mighty man, and he can command fifty, yea, even he can slay fifty; then why not us?", pr:[{id:"murmuring",name:"Murmuring"},{id:"hardness-of-heart",name:"Hardness of Heart"}], pe:[{id:"laban-1",name:"Laban"},{id:"laman-1",name:"Laman"},{id:"lemuel-1",name:"Lemuel"}], pl:[], o:["1-ne-4-1","1-sam-17-11","dc-3-7","num-13-31"], i:["1-ne-17-18","1-ne-4-36","1-ne-7-11"] },
  ],
};

const TALKS = [
  { id:"jack-1990", speaker:"Elaine L. Jack", office:"Relief Society General President", title:"I Will Go and Do", dateLabel:"Apr 1990", year:1990, cites:[7], framing:"Accepted the call to lead the Relief Society on Nephi's resolve — without believing the Lord prepares a way, she said, there was no way to take it on.", url:"https://www.churchofjesuschrist.org/study/general-conference/1990/04/i-will-go-and-do?lang=eng" },
  { id:"eyring-2010", speaker:"Henry B. Eyring", office:"First Counselor, First Presidency", title:"Trust in God, Then Go and Do", dateLabel:"Oct 2010", year:2010, cites:[7], framing:"Trusting God means listening for His message in conference and then going and doing it — obedience that, over time, leads Him to trust us in return.", url:"https://www.churchofjesuschrist.org/study/general-conference/2010/10/trust-in-god-then-go-and-do?lang=eng" },
  { id:"monson-2013", speaker:"Thomas S. Monson", office:"President of the Church", title:"Obedience Brings Blessings", dateLabel:"Apr 2013", year:2013, cites:[7], framing:"Held up Nephi as one who never once failed to do what the Lord commanded — the pattern by which obedience brings blessings.", url:"https://www.churchofjesuschrist.org/study/general-conference/2013/04/obedience-brings-blessings?lang=eng" },
];

const ENTITY_ROLE = {
  "nephi-1":"Son of Lehi · narrator of this record","lehi-1":"Prophet · father of Nephi",
  "laban-1":"Keeper of the brass plates in Jerusalem","laman-1":"Eldest son of Lehi","lemuel-1":"Second son of Lehi",
  "sam-1":"Faithful third son of Lehi. Present in this chapter but never named — he is one of \u201Ctheir younger brothers\u201D beaten by Laman and Lemuel and visited by the angel (vv. 28–29).",
  "personal-revelation":"How God speaks to an individual","obedience":"Acting on the Lord's commandments",
  "murmuring":"Complaint and resistance against direction","record-keeping":"Preserving sacred records and language",
  "hardness-of-heart":"Resistance to the Spirit","endure-to-end":"Faithful persistence to completion",
  "divine-protection":"Deliverance by the Lord's hand","revelation":"God making truth known","faith":"Trust in God that precedes the witness","angels":"Ministering messengers of God",
  "tent-of-lehi":"The family's camp in the wilderness","jerusalem":"The city the family fled; destination of the errand","wilderness":"The desert region of their journey","land-of-jerusalem":"The land surrounding the city","land-of-fathers-inheritance":"Lehi's abandoned estate and riches",
};

/* Principle nodes — real where pulled from the graph (obedience, endure-to-end);
   description is NULL in the graph for every principle, so definitions are an
   authored/editable layer here. Verse lists from get_principle are capped at 20
   and alphabetical (they even omit 1 Ne 3:7 under Obedience) — flagged in-page. */
const PRINCIPLE_NAME = {
  "obedience":"Obedience","endure-to-end":"Endure to the End","seeking-first-kingdom":"Seek First the Kingdom of God",
  "building-on-rock":"Building on the Rock of Christ","persecution-endurance":"Enduring Persecution",
  "murmuring":"Murmuring","record-keeping":"Record Keeping & Scripture","hardness-of-heart":"Hardness of Heart",
  "personal-revelation":"Personal Revelation","divine-protection":"Divine Protection","revelation":"Revelation",
  "faith":"Faith","angels":"Angels",
};
const PRINCIPLES = {
  "obedience":{ verseCount:20, parents:[], children:["endure-to-end","seeking-first-kingdom","building-on-rock"],
    verses:[
      {id:"1-chr-14-16",ref:"1 Chronicles 14:16",text:"David therefore did as God commanded him: and they smote the host of the Philistines."},
      {id:"1-chr-15-13",ref:"1 Chronicles 15:13",text:"For because ye did it not at the first, the Lord our God made a breach upon us, for that we sought him not after the due order."},
      {id:"1-chr-21-19",ref:"1 Chronicles 21:19",text:"And David went up at the saying of Gad, which he spake in the name of the Lord."},
      {id:"1-chr-28-10",ref:"1 Chronicles 28:10",text:"Take heed now; for the Lord hath chosen thee to build an house for the sanctuary: be strong, and do it."},
      {id:"1-chr-29-19",ref:"1 Chronicles 29:19",text:"And give unto Solomon my son a perfect heart, to keep thy commandments, thy testimonies, and thy statutes."},
      {id:"1-cor-7-19",ref:"1 Corinthians 7:19",text:"Circumcision is nothing, and uncircumcision is nothing, but the keeping of the commandments of God."},
      {id:"1-jn-2-17",ref:"1 John 2:17",text:"And the world passeth away, and the lust thereof: but he that doeth the will of God abideth for ever."},
    ]},
  "endure-to-end":{ verseCount:20, parents:["obedience"], children:["persecution-endurance"],
    verses:[
      {id:"1-cor-15-58",ref:"1 Corinthians 15:58",text:"Therefore, my beloved brethren, be ye steadfast, unmoveable, always abounding in the work of the Lord."},
      {id:"1-cor-9-24",ref:"1 Corinthians 9:24",text:"Know ye not that they which run in a race run all, but one receiveth the prize? So run, that ye may obtain."},
      {id:"1-ne-13-37",ref:"1 Nephi 13:37",text:"And blessed are they who shall seek to bring forth my Zion at that day... if they endure unto the end they shall be lifted up at the last day."},
      {id:"1-ne-22-31",ref:"1 Nephi 22:31",text:"If ye shall be obedient to the commandments, and endure to the end, ye shall be saved at the last day."},
      {id:"1-ne-3-15",ref:"1 Nephi 3:15",text:"As the Lord liveth, and as we live, we will not go down unto our father... until we have accomplished the thing which the Lord hath commanded us."},
      {id:"1-pet-1-7",ref:"1 Peter 1:7",text:"That the trial of your faith, being much more precious than of gold that perisheth, though it be tried with fire..."},
      {id:"1-tim-4-16",ref:"1 Timothy 4:16",text:"Take heed unto thyself, and unto the doctrine; continue in them: for in doing this thou shalt both save thyself, and them that hear thee."},
    ]},
  // hierarchy-only stubs (children/parents known, verse lists load from graph live)
  "seeking-first-kingdom":{ verseCount:null, parents:["obedience"], children:[], verses:[] },
  "building-on-rock":{ verseCount:null, parents:["obedience"], children:[], verses:[] },
  "persecution-endurance":{ verseCount:null, parents:["endure-to-end"], children:[], verses:[] },
};
const BOOK = {"1-ne":"1 Ne","2-ne":"2 Ne","3-ne":"3 Ne","jacob":"Jacob","enos":"Enos","jarom":"Jarom","omni":"Omni","mosiah":"Mosiah","alma":"Alma","hel":"Hel","ether":"Ether","moroni":"Moro","gen":"Gen","ex":"Ex","num":"Num","deut":"Deut","josh":"Josh","ruth":"Ruth","1-sam":"1 Sam","2-sam":"2 Sam","1-kgs":"1 Kgs","2-kgs":"2 Kgs","2-chr":"2 Chr","neh":"Neh","ps":"Ps","prov":"Prov","eccl":"Eccl","isa":"Isa","jer":"Jer","zech":"Zech","matt":"Matt","luke":"Luke","john":"John","acts":"Acts","1-cor":"1 Cor","2-cor":"2 Cor","philip":"Philip","1-tim":"1 Tim","2-tim":"2 Tim","2-pet":"2 Pet","rev":"Rev","dc":"D&C"};
const BOOK_VOL=(()=>{const v={};["gen","ex","num","deut","josh","ruth","1-sam","2-sam","1-kgs","2-kgs","2-chr","neh","ps","prov","eccl","isa","jer","zech"].forEach(b=>v[b]="OT");["matt","luke","john","acts","1-cor","2-cor","philip","1-tim","2-tim","2-pet","rev"].forEach(b=>v[b]="NT");["1-ne","2-ne","3-ne","jacob","enos","jarom","omni","mosiah","alma","hel","ether","moroni"].forEach(b=>v[b]="BoM");v["dc"]="D&C";return v;})();
function parseRef(id){const p=id.split("-");const verse=p.pop(),chap=p.pop(),book=p.join("-");return{book,chap,verse,label:`${BOOK[book]||book} ${chap}:${verse}`,vol:BOOK_VOL[book]||""};}
const inChapter=(id)=>id.startsWith("1-ne-3-");
const verseNumFromId=(id)=>parseInt(id.split("-").pop(),10);

const CATS={principle:{label:"Principles",color:"#b07d2b"},person:{label:"People",color:"#2f6f5e"},place:{label:"Places",color:"#b5562f"},out:{label:"Cites",color:"#3a4a7a"},in:{label:"Cited by",color:"#80395f"},gc:{label:"Conference",color:"#8a3a3a"}};

/* ─── COLLECTIONS REGISTRY ──────────────────────────────────────────────────
   Every connection layer is a collection. Tiers: canon (pinned, always on),
   app (opt-in, published by the app), community (user-built, shareable),
   personal (private, write-enabled). Each carries provenance + license, and a
   storage rule: "prose" collections (public domain) show full text inline;
   "link" collections (copyrighted) show a fact + deep link, never stored prose.
   Accessors read the existing verse graph + seeded layer data below.        */

// Public-domain dictionary entries (store full prose). Easton's-style. Bible-only.
const EASTON = {
  "jerusalem":{ entry:"The chief city of Palestine and the spiritual center of the covenant people. Its name is often connected with \u201Cfoundation of peace.\u201D Repeatedly besieged and rebuilt, it stands throughout scripture as both the city of God's house and the city that rejects the prophets.", verses:[2,9,10,17,18,29] },
  "wilderness":{ entry:"Uncultivated, unsettled country, often pasture or desert rather than barren waste. In scripture the wilderness is the place of testing, dependence, and divine provision through which the covenant people are led.", verses:[4,9,14,15,27] },
};
// Guide to the Scriptures (IRI \u2014 link only; store a fact + deep link, no prose).
const GUIDE = {
  "obedience":{ gloss:"To do the will of God. The first law of heaven; the foundation of all righteousness and progress.", url:"https://www.churchofjesuschrist.org/study/scriptures/gs/obedience-obey-obedient?lang=eng", verses:[5,7,9,21] },
  "faith":{ gloss:"Confidence in something or someone. Faith in Jesus Christ unto salvation centers on trust in His person, perfections, and power.", url:"https://www.churchofjesuschrist.org/study/scriptures/gs/faith?lang=eng", verses:[7] },
  "record-keeping":{ gloss:"The scriptures \u2014 sacred writings preserved and handed down to keep the word of God and the language of the fathers.", url:"https://www.churchofjesuschrist.org/study/scriptures/gs/scriptures?lang=eng", verses:[3,11,19,20] },
};
// Word study (public domain Strong's-style lemma data). Keyed to verse 7.
const WORDS = {
  7:[ {w:"commanded",lemma:"\u05E6\u05B8\u05D5\u05B8\u0939 (tsavah)",strong:"H6680",gloss:"to charge, appoint, give a command \u2014 the verb of covenant instruction"},
      {w:"prepare a way",lemma:"\u05E4\u05B8\u05BC\u05E0\u05B8\u05D4 (panah)",strong:"H6437",gloss:"to turn, clear, make open \u2014 to remove obstacles before someone"} ],
};

/* Word-level Strong's stub — illustrative lemma data keyed by surface word.
   In the real build each word is its own occurrence row pointing at a shared
   lemma node, so this is the read-time shape of that join, faked for a few
   common words. Hover any word in the reading column to see it. */
const STRONGS_STUB = {
  lord:{heb:"יְהוָה",translit:"YHWH",strong:"H3068",gloss:"The proper, covenant name of the God of Israel — “He who is.”"},
  god:{heb:"אֱלֹהִים",translit:"elohim",strong:"H430",gloss:"God; the supreme deity. Plural form used of the one true God."},
  commanded:{heb:"צָוָה",translit:"tsavah",strong:"H6680",gloss:"To charge, appoint, give a command — the verb of covenant instruction."},
  commandments:{heb:"מִצְוָה",translit:"mitzvah",strong:"H4687",gloss:"A commandment or precept given by God."},
  command:{heb:"צָוָה",translit:"tsavah",strong:"H6680",gloss:"To charge, appoint, give a command."},
  father:{heb:"אָב",translit:"av",strong:"H1",gloss:"Father; head of a household or lineage."},
  way:{heb:"דֶּרֶךְ",translit:"derek",strong:"H1870",gloss:"A road or path; figuratively a course or manner of life."},
  prepare:{heb:"פָּנָה",translit:"panah",strong:"H6437",gloss:"To turn, clear, make open — to remove obstacles before someone."},
  soul:{heb:"נֶפֶשׁ",translit:"nephesh",strong:"H5315",gloss:"The living self — soul, life, person, appetite."},
  heart:{heb:"לֵב",translit:"lev",strong:"H3820",gloss:"The inner person — mind, will, and affections."},
  spirit:{heb:"רוּחַ",translit:"ruach",strong:"H7307",gloss:"Wind, breath, spirit — the animating force."},
  children:{heb:"בֵּן",translit:"ben",strong:"H1121",gloss:"Son, child, descendant."},
  men:{heb:"אָדָם",translit:"adam",strong:"H120",gloss:"Mankind; a human being."},
  know:{heb:"יָדַע",translit:"yada",strong:"H3045",gloss:"To know by experience, perceive, be acquainted with."},
  go:{heb:"הָלַךְ",translit:"halak",strong:"H1980",gloss:"To go, walk, come; to live or conduct oneself."},
  hand:{heb:"יָד",translit:"yad",strong:"H3027",gloss:"Hand; figuratively power, means, or direction."},
};
// Community collection (third-party, auto-extracted). Example podcast.
const PODCAST = [
  { id:"pod-ne3", host:"Scripture Study Podcast", title:"Why \u201CI Will Go and Do\u201D Is Not About Willpower", dateLabel:"Mar 2024", verses:[7],
    framing:"Episode argues Nephi's confidence rests on a doctrine of divine enablement, not personal grit \u2014 the clause \u201Che shall prepare a way\u201D is the load-bearing phrase.",
    url:"https://example.com/scripture-study-podcast/i-will-go-and-do" },
];

const COLLECTIONS = [
  { id:"crossref", tier:"canon", name:"Cross-references", color:"#3a4a7a", license:"IRI", provenance:"official", storage:"facts", pinned:true,
    note:"The footnote and Topical Guide apparatus." },
  { id:"principle", tier:"canon", name:"Principles", color:"#b07d2b", license:"IRI", provenance:"official", storage:"facts", pinned:true,
    note:"Doctrinal principles taught by each verse." },
  { id:"people", tier:"canon", name:"People & Places", color:"#2f6f5e", license:"IRI", provenance:"official", storage:"facts", pinned:true,
    note:"Persons and places mentioned." },
  { id:"gc", tier:"app", name:"General Conference", color:"#8a3a3a", license:"IRI", provenance:"official-index", storage:"link",
    note:"Talks citing this verse. Facts + deep link; talk text stays at the source." },
  { id:"guide", tier:"app", name:"Guide to the Scriptures", color:"#6a5a8a", license:"IRI", provenance:"official-index", storage:"link",
    note:"Topical definitions. Link-only: a one-line gloss plus a link out." },
  { id:"easton", tier:"app", name:"Easton's Bible Dictionary", color:"#4a6f5a", license:"Public domain", provenance:"curated", storage:"prose",
    note:"Public domain, so full entries are stored and shown inline. Bible entities only." },
  { id:"words", tier:"app", name:"Word study (Strong's)", color:"#9a6a2a", license:"Public domain", provenance:"curated", storage:"prose",
    note:"Hebrew/Greek lemma + Strong's. Public domain; stored in full." },
  { id:"podcast", tier:"community", name:"Scripture Study Podcast", color:"#5a7a8a", license:"Third-party", provenance:"auto-extracted", storage:"link",
    note:"Example community collection. Citations auto-extracted from transcripts; link-only." },
  { id:"notes", tier:"personal", name:"My Notes", color:"#2f3a56", license:"Yours", provenance:"personal", storage:"prose",
    note:"Your private layer. Edges into any node; stored and owned by you." },
];
const TIER_LABEL = { canon:"Canonical", app:"App collections", community:"Community", personal:"Personal" };
const PROV_LABEL = { "official":"Official", "official-index":"Official index", "curated":"Curated", "auto-extracted":"Auto-extracted", "personal":"Yours" };
const PROV_COLOR = { "official":"#2f6f5e", "official-index":"#2f6f5e", "curated":"#b07d2b", "auto-extracted":"#5a7a8a", "personal":"#2f3a56" };
const NAME = Object.assign({}, PRINCIPLE_NAME,
  Object.fromEntries(CHAPTER.summary.people.map(x=>[x.id,x.name])),
  Object.fromEntries(CHAPTER.summary.places.map(x=>[x.id,x.name])));
const TYPE_LEGEND = { verse:"Verse", xverse:"Verse (external)", principle:"Principle", person:"Person", place:"Place", talk:"Conference", guide:"Guide", dict:"Dictionary", word:"Word", podcast:"Podcast", note:"Note" };

const VOL_COLOR={OT:"#8a7a4e",NT:"#4a6f8a",BoM:"#7c4a2d","D&C":"#5a4a7a",PGP:"#6a5a3a"};

const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Archivo:wght@500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
.lm-root{--paper:#f3ede1;--panel:#faf6ee;--panel2:#f0e8d8;--ink:#2a251f;--muted:#776a57;--faint:#9b8e78;--rule:#e3d9c6;--rule2:#d8ccb5;--accent:#2f3a56;--sel:#f6e9c8;--selbar:#b07d2b;--gc:#8a3a3a;--gctint:#f7ece8;
  font-family:'Archivo',system-ui,sans-serif;color:var(--ink);background:var(--paper);
  background-image:radial-gradient(circle at 18% 12%,rgba(176,125,43,.05),transparent 45%),radial-gradient(circle at 82% 88%,rgba(47,58,86,.05),transparent 42%);height:100vh;display:flex;flex-direction:column;overflow:hidden}
.lm-head{padding:16px 26px 11px;border-bottom:1px solid var(--rule);background:linear-gradient(var(--panel),rgba(250,246,238,0));flex:none}
.lm-kicker{font:600 11px/1 'Archivo';letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}
.lm-title{font:500 28px/1.05 'Fraunces';letter-spacing:-.01em;margin:6px 0 3px}
.lm-title em{font-style:italic;color:var(--accent)}
.lm-sub{font:400 13px/1.4 'Newsreader';color:var(--muted);max-width:62ch;font-style:italic}
.lm-legend{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}
.lm-chipf{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule2);background:var(--panel);border-radius:999px;padding:5px 11px 5px 9px;font:600 11px 'Archivo';letter-spacing:.03em;color:var(--muted);cursor:pointer;transition:.16s}
.lm-chipf:hover{border-color:var(--faint);color:var(--ink)}
.lm-chipf.off{opacity:.38;text-decoration:line-through}
.lm-dot{width:9px;height:9px;border-radius:50%;flex:none}
.lm-body{flex:1;display:grid;grid-template-columns:282px minmax(0,1fr) 410px;min-height:0}
/* STUDY PANE */
.lm-left{border-right:1px solid var(--rule);background:var(--panel2);overflow-y:auto;padding:22px 20px 50px}
.lm-left h4{font:700 10.5px 'Archivo';letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:0 0 9px}
.lm-left h4.mt{margin-top:24px}
.lm-sum{font:400 14px/1.62 'Newsreader';color:var(--ink)}
.lm-theme{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.lm-theme span{font:500 11.5px 'Archivo';background:#fff;border:1px solid var(--rule2);border-radius:999px;padding:4px 10px;color:var(--muted)}
.lm-roll{display:flex;flex-wrap:wrap;gap:5px}
.lm-rollchip{display:inline-flex;align-items:center;gap:5px;font:600 11.5px 'Archivo';background:#fff;border:1px solid var(--rule2);border-left-width:3px;border-radius:6px;padding:4px 9px;cursor:pointer;transition:.14s;color:var(--ink)}
.lm-rollchip:hover{border-color:var(--accent);transform:translateY(-1px)}
/* READING */
.lm-read{overflow-y:auto;padding:24px 30px 120px;scroll-behavior:smooth}
.lm-read-inner{max-width:680px;margin:0 auto}
.lm-sum-inline{display:none}
.lm-v{position:relative;display:block;width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 14px 9px 58px;border-radius:8px;font:400 19px/1.62 'Newsreader';color:var(--ink);transition:background .18s,opacity .25s;animation:fade .5s both}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.lm-v:hover{background:rgba(176,125,43,.07)}
.lm-v .num{position:absolute;left:20px;top:12px;width:30px;text-align:right;font:600 12px 'Archivo';color:var(--faint);transition:.18s}
.lm-v.sel{background:var(--sel)}
.lm-heat{position:absolute;left:7px;top:8px;bottom:8px;width:4px;border-radius:3px;transition:.18s}
.lm-v.sel .lm-heat{box-shadow:0 0 0 1.5px var(--selbar);left:6px;width:6px}
.lm-v.sel .num{color:var(--selbar)}
.lm-v.dim{opacity:.32}
.lm-v.member{background:rgba(47,111,94,.08)}
.lm-v.gcmember{background:var(--gctint)}
.lm-v .tags{display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle;opacity:.85}
.lm-v .tags i{width:6px;height:6px;border-radius:50%;display:inline-block}
.lm-v .star{margin-left:7px;font:700 10px 'Archivo';color:var(--gc);vertical-align:middle;letter-spacing:.04em}
.lm-v .note{margin-left:7px;font:700 10px 'Archivo';color:var(--accent);vertical-align:middle}
.lm-v .cc{font:600 10px 'Archivo';color:var(--faint);margin-left:7px;vertical-align:middle;letter-spacing:.04em}
/* RAIL */
.lm-rail{border-left:1px solid var(--rule);background:var(--panel);overflow:hidden;display:flex;flex-direction:column}
.lm-tabs{display:flex;gap:2px;padding:14px 16px 0;border-bottom:1px solid var(--rule);flex:none}
.lm-tab{font:700 11px 'Archivo';letter-spacing:.07em;text-transform:uppercase;color:var(--faint);background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px 11px;cursor:pointer;transition:.14s}
.lm-tab:hover{color:var(--ink)}
.lm-tab.on{color:var(--ink);border-bottom-color:var(--selbar)}
.lm-tab .b{font-size:9px;background:var(--rule2);color:var(--ink);border-radius:8px;padding:1px 5px;margin-left:5px;vertical-align:middle}
.lm-rail-scroll{overflow-y:auto;padding:18px 20px 60px}
.lm-rail-ref{font:500 22px 'Fraunces';letter-spacing:-.01em}
.lm-rail-meta{font:600 11px 'Archivo';letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-top:4px}
.lm-rail-quote{font:400 14.5px/1.5 'Newsreader';color:var(--muted);font-style:italic;margin:12px 0 4px;border-left:2px solid var(--rule2);padding-left:12px}
.lm-strata{font:600 9px 'Archivo';letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:22px 0 2px}
/* provenance + license badges */
.lm-badge{display:inline-flex;align-items:center;gap:4px;font:700 8.5px 'Archivo';letter-spacing:.06em;text-transform:uppercase;border-radius:5px;padding:2px 6px;white-space:nowrap}
.lm-badge.lic{background:var(--panel2);color:var(--muted);border:1px solid var(--rule2)}
.lm-store{font:600 9px 'Archivo';letter-spacing:.04em;color:var(--faint)}
/* collection section header */
.lm-col-h{display:flex;align-items:center;gap:8px;margin:22px 0 9px;flex-wrap:wrap}
.lm-col-h .nm{font:700 11px 'Archivo';letter-spacing:.08em;text-transform:uppercase;color:var(--ink)}
.lm-col-h .ct{font:600 10px 'Archivo';color:var(--faint)}
.lm-col-h .sw{width:10px;height:10px;border-radius:3px;flex:none}
.lm-col-empty{font:400 12.5px/1.5 'Newsreader';font-style:italic;color:var(--faint);padding:2px 0 4px}
/* dictionary entry (prose) card */
.lm-dict{border:1px solid var(--rule2);border-left:3px solid #4a6f5a;border-radius:9px;background:#fff;padding:11px 13px;margin-bottom:8px}
.lm-dict-term{font:500 15px 'Fraunces';margin-bottom:5px}
.lm-dict-body{font:400 13.5px/1.55 'Newsreader';color:var(--ink)}
/* guide (link-only) card */
.lm-glink{border:1px solid var(--rule2);border-left:3px solid #6a5a8a;border-radius:9px;background:#fff;padding:11px 13px;margin-bottom:8px}
.lm-glink-term{display:flex;align-items:center;gap:8px;font:500 14px 'Fraunces';margin-bottom:4px}
.lm-glink-gloss{font:400 13px/1.5 'Newsreader';color:var(--muted)}
.lm-glink-a{display:inline-block;margin-top:7px;font:600 11px 'Archivo';color:var(--accent);text-decoration:none;border-bottom:1px solid var(--rule2)}
.lm-glink-a:hover{border-color:var(--accent)}
/* word chips */
.lm-word{display:inline-flex;flex-direction:column;gap:1px;border:1px solid var(--rule2);border-left:3px solid #9a6a2a;border-radius:8px;background:#fff;padding:7px 11px;margin:0 6px 6px 0}
.lm-word .wl{font:600 12px 'Archivo';color:var(--ink)}
.lm-word .wlem{font:500 13px 'Newsreader';color:var(--muted)}
.lm-word .wg{font:400 11.5px/1.4 'Newsreader';color:var(--faint);max-width:300px}
.lm-word .ws{font:700 8.5px 'Archivo';letter-spacing:.05em;color:#9a6a2a}
.lm-w{border-radius:3px}
@media(hover:hover){
  .lm-w{transition:background .1s,box-shadow .1s}
  .lm-w:hover{background:rgba(176,125,43,.16);box-shadow:inset 0 -2px 0 rgba(176,125,43,.55);cursor:help}
  .lm-w.mapped{box-shadow:inset 0 -1px 0 rgba(154,106,42,.30)}
  .lm-w.mapped:hover{background:rgba(154,106,42,.16);box-shadow:inset 0 -2px 0 rgba(154,106,42,.75)}
}
.lm-wtip{position:fixed;transform:translate(-50%,calc(-100% - 12px));z-index:72;pointer-events:none;width:max-content;max-width:268px;background:var(--panel);border:1px solid var(--rule2);border-radius:11px;box-shadow:0 14px 36px rgba(42,37,31,.28);padding:12px 14px;animation:fade .12s both}
.lm-wtip .surf{font:600 11px 'Archivo';letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
.lm-wtip .lem{font:500 21px 'Newsreader';line-height:1.1;margin:4px 0 1px}
.lm-wtip .translit{font:500 13.5px 'Newsreader';font-style:italic;color:var(--muted)}
.lm-wtip .row{display:flex;align-items:center;gap:8px;margin-top:8px}
.lm-wtip .sn{font:700 9px 'Archivo';letter-spacing:.06em;background:rgba(154,106,42,.16);color:#8a5a1f;border-radius:5px;padding:2px 7px}
.lm-wtip .gloss{font:400 12.5px/1.5 'Newsreader';color:var(--ink);margin-top:8px}
.lm-wtip .none{font:400 12.5px/1.45 'Newsreader';font-style:italic;color:var(--faint);margin-top:4px}
.lm-wtip .stub{font:700 8px 'Archivo';letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-top:9px}
/* COLLECTIONS MANAGER slide-over */
.lm-mgr-ov{position:fixed;inset:0;background:rgba(42,37,31,.4);z-index:60;display:flex;justify-content:flex-start;animation:fade .2s both}
.lm-mgr{width:380px;max-width:90vw;height:100%;background:var(--panel);border-right:1px solid var(--rule2);box-shadow:8px 0 40px rgba(42,37,31,.25);overflow-y:auto;padding:22px 22px 50px;animation:slidein .26s cubic-bezier(.3,.8,.3,1) both}
@keyframes slidein{from{transform:translateX(-16px);opacity:.4}to{transform:none;opacity:1}}
.lm-mgr-top{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
.lm-mgr-title{font:500 23px 'Fraunces'}
.lm-mgr-x{margin-left:auto;font:700 18px 'Archivo';color:var(--muted);background:none;border:0;cursor:pointer}
.lm-mgr-sub{font:400 13px/1.5 'Newsreader';font-style:italic;color:var(--muted);margin-bottom:14px}
.lm-mgr-tier{font:700 10px 'Archivo';letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:20px 0 8px}
.lm-mgr-row{display:flex;align-items:flex-start;gap:11px;background:#fff;border:1px solid var(--rule2);border-radius:10px;padding:11px 13px;margin-bottom:8px}
.lm-mgr-row .sw{width:12px;height:12px;border-radius:4px;margin-top:3px;flex:none}
.lm-mgr-row .body{flex:1;min-width:0}
.lm-mgr-row .nm{font:600 14px 'Archivo';display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lm-mgr-row .meta{display:flex;align-items:center;gap:7px;margin-top:4px;flex-wrap:wrap}
.lm-mgr-row .note{font:400 12px/1.45 'Newsreader';color:var(--muted);margin-top:7px}
.lm-pin{font:700 11px 'Archivo';color:var(--faint);background:none;border:0;cursor:pointer;padding:2px}
.lm-pin.on{color:var(--selbar)}
/* toggle switch */
.lm-sw{position:relative;width:38px;height:22px;border-radius:12px;background:var(--rule2);border:0;cursor:pointer;flex:none;transition:.16s;margin-top:1px}
.lm-sw.on{background:var(--accent)}
.lm-sw::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.16s}
.lm-sw.on::after{left:18px}
.lm-sw.locked{opacity:.5;cursor:not-allowed}
/* legend quick-toggle (collection pills) */
.lm-mgr-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule2);background:var(--panel2);border-radius:999px;padding:5px 12px;font:700 11px 'Archivo';letter-spacing:.04em;color:var(--accent);cursor:pointer;transition:.16s}
.lm-mgr-btn:hover{border-color:var(--accent)}
/* graph slide-over deferred stub */
.lm-graphbtn{font:700 10.5px 'Archivo';letter-spacing:.05em;color:var(--accent);background:none;border:1px solid var(--rule2);border-radius:7px;padding:6px 11px;cursor:pointer;margin-left:auto}
.lm-graphbtn:hover{border-color:var(--accent)}
.gfade{animation:fade .35s both}
.lm-graph-card{position:relative;width:min(880px,95vw);height:min(740px,92vh);background:var(--panel);border:1px solid var(--rule2);border-radius:16px;box-shadow:0 24px 60px rgba(42,37,31,.32);display:flex;flex-direction:column;overflow:hidden;animation:fade .2s both}
.lm-graph-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--rule);flex-wrap:wrap}
.lm-graph-kick{font:700 9px 'Archivo';letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.lm-graph-title{font:500 21px 'Fraunces';line-height:1.05}
.lm-graph-ctrl{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lm-depth{display:inline-flex;align-items:center;gap:7px;font:700 10px 'Archivo';letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.lm-depth .seg{display:inline-flex;border:1px solid var(--rule2);border-radius:8px;overflow:hidden}
.lm-depth .seg button{font:700 11px 'Archivo';padding:6px 12px;border:0;background:#fff;color:var(--muted);cursor:pointer}
.lm-depth .seg button.on{background:var(--accent);color:#fff}
.lm-graph-svgwrap{flex:1;min-height:0;background:radial-gradient(circle at 50% 44%,#fcf8f0,#efe7d6)}
.lm-gnode.click{cursor:pointer}
.lm-gnode.click:hover circle{stroke:var(--accent);stroke-width:3}
.lm-glabel{font:600 10.5px 'Archivo';fill:#2a251f;pointer-events:none;paint-order:stroke;stroke:#fbf7ef;stroke-width:3px}
.lm-gedge{stroke:#cdbfa4}
.lm-graph-legend{display:flex;flex-wrap:wrap;gap:7px 14px;padding:10px 18px;border-top:1px solid var(--rule);background:var(--panel)}
.lm-graph-legend span{display:inline-flex;align-items:center;gap:6px;font:600 10px 'Archivo';color:var(--muted)}
.lm-graph-legend i{width:9px;height:9px;border-radius:50%}
.lm-graph-foot{font:400 11.5px/1.4 'Newsreader';font-style:italic;color:var(--faint);padding:9px 18px 12px;border-top:1px solid var(--rule)}
.lm-gbtn{font:700 11px 'Archivo';border:1px solid var(--rule2);background:#fff;border-radius:7px;padding:6px 11px;cursor:pointer;color:var(--ink)}
.lm-gbtn:hover{border-color:var(--accent)}
.lm-gbtn.ghost{background:none}
.lm-graph-x{font:700 18px 'Archivo';color:var(--muted);background:none;border:0;cursor:pointer;padding:2px 6px}
.lm-graph-x:hover{color:var(--ink)}
.lm-sec{margin-top:18px}
.lm-sec.canon{padding-top:16px;border-top:1px dashed var(--rule2)}
.lm-sec-h{display:flex;align-items:center;gap:8px;font:700 11px 'Archivo';letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:9px}
.lm-sec-h .n{margin-left:auto;font-weight:600;color:var(--faint)}
.lm-chips{display:flex;flex-wrap:wrap;gap:6px}
.lm-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--rule2);background:#fff;border-radius:7px;padding:6px 10px;font:600 12.5px 'Archivo';color:var(--ink);cursor:pointer;transition:.14s}
.lm-chip:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:0 3px 9px rgba(42,37,31,.07)}
.lm-chip .vtag{font:700 9px 'Archivo';letter-spacing:.05em;padding:1px 4px;border-radius:4px;color:#fff}
.lm-chip.ext{cursor:default;color:var(--muted);background:transparent;border-style:dashed}
.lm-chip.ext:hover{transform:none;box-shadow:none;border-color:var(--rule2)}
.lm-chip.entity{border-left-width:3px}
.lm-more{font:600 11.5px 'Archivo';letter-spacing:.04em;color:var(--accent);background:none;border:0;cursor:pointer;padding:6px 4px;text-decoration:underline;text-underline-offset:3px}
.lm-empty{font:400 13px/1.5 'Newsreader';color:var(--faint);font-style:italic;padding:34px 6px;text-align:center}
.lm-gc{border:1px solid var(--rule2);border-left:3px solid var(--gc);border-radius:9px;background:#fff;padding:11px 13px;margin-bottom:8px}
.lm-gc-top{display:flex;align-items:baseline;gap:8px}
.lm-gc-speaker{font:600 13.5px 'Archivo';color:var(--gc);background:none;border:0;padding:0;cursor:pointer;text-align:left}
.lm-gc-speaker:hover{text-decoration:underline}
.lm-gc-date{margin-left:auto;font:600 10.5px 'Archivo';letter-spacing:.05em;color:var(--faint)}
.lm-gc-office{font:500 10.5px 'Archivo';letter-spacing:.03em;color:var(--muted);margin-top:1px}
.lm-gc-title{font:500 15px 'Fraunces';font-style:italic;margin:6px 0 4px}
.lm-gc-frame{font:400 13px/1.5 'Newsreader';color:var(--muted)}
.lm-gc-link{display:inline-block;margin-top:7px;font:600 11px 'Archivo';letter-spacing:.02em;color:var(--accent);text-decoration:none;border-bottom:1px solid var(--rule2);padding-bottom:1px}
.lm-gc-link:hover{border-color:var(--accent)}
.lm-gc-acts{display:flex;gap:12px;align-items:center;margin-top:9px;flex-wrap:wrap}
.lm-gc-readbtn{font:700 11px 'Archivo';letter-spacing:.04em;color:#fff;background:var(--gc);border:0;border-radius:6px;padding:6px 12px;cursor:pointer;transition:.14s}
.lm-gc-readbtn:hover{filter:brightness(1.12)}
.lm-reader-ov{position:fixed;inset:0;background:rgba(42,37,31,.42);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:50;padding:24px;animation:fade .2s both}
.lm-reader-card{position:relative;max-width:560px;width:100%;max-height:84vh;overflow-y:auto;background:var(--panel);border:1px solid var(--rule2);border-radius:14px;padding:30px 34px;box-shadow:0 24px 60px rgba(42,37,31,.32)}
.lm-reader-x{position:absolute;right:15px;top:13px;font:700 19px 'Archivo';color:var(--faint);background:none;border:0;cursor:pointer;line-height:1}
.lm-reader-x:hover{color:var(--ink)}
.lm-reader-kick{font:700 10px 'Archivo';letter-spacing:.16em;text-transform:uppercase;color:var(--gc)}
.lm-reader-title{font:500 27px/1.15 'Fraunces';margin:8px 0 6px}
.lm-reader-by{font:600 12.5px 'Archivo';letter-spacing:.03em;color:var(--muted)}
.lm-reader-rule{height:1px;background:var(--rule2);margin:18px 0}
.lm-reader-stub{font:400 13px/1.55 'Newsreader';font-style:italic;color:var(--faint);margin-bottom:14px}
.lm-reader-frame{font:400 16px/1.66 'Newsreader';color:var(--ink)}
.lm-reader-link{display:inline-block;margin-top:20px;font:600 12px 'Archivo';letter-spacing:.03em;color:var(--accent);text-decoration:none;border-bottom:1px solid var(--rule2);padding-bottom:2px}
.lm-reader-link:hover{border-color:var(--accent)}
.lm-tl{position:relative;height:46px;margin:4px 2px 12px}
.lm-tl-line{position:absolute;left:0;right:0;top:23px;height:2px;background:var(--rule2)}
.lm-tl-pt{position:absolute;transform:translateX(-50%);top:14px;display:flex;flex-direction:column;align-items:center}
.lm-tl-dot{width:11px;height:11px;border-radius:50%;background:var(--gc);border:2px solid var(--panel)}
.lm-tl-yr{font:600 9.5px 'Archivo';color:var(--muted);margin-top:5px}
.lm-back{display:inline-flex;align-items:center;gap:6px;font:600 11px 'Archivo';letter-spacing:.04em;color:var(--accent);background:none;border:0;cursor:pointer;margin-bottom:10px;text-transform:uppercase}
.lm-ent-card{border:1px solid var(--rule2);border-radius:10px;padding:14px 15px;background:#fff}
.lm-ent-type{font:700 10px 'Archivo';letter-spacing:.12em;text-transform:uppercase}
.lm-ent-name{font:500 24px 'Fraunces';margin:4px 0 6px}
.lm-ent-role{font:400 13.5px/1.5 'Newsreader';color:var(--muted)}
.lm-ent-h{font:700 11px 'Archivo';letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:18px 0 9px}
.lm-vchips{display:flex;flex-wrap:wrap;gap:6px}
.lm-vchip{font:600 12px 'Archivo';border:1px solid var(--rule2);background:#fff;border-radius:6px;padding:5px 9px;cursor:pointer;transition:.14s}
.lm-vchip:hover{border-color:var(--accent);background:var(--sel)}
/* NOTES */
.lm-note-stub{font:400 11.5px/1.4 'Newsreader';color:var(--faint);font-style:italic;margin:2px 0 14px}
.lm-note-form{background:#fff;border:1px solid var(--rule2);border-radius:10px;padding:12px}
.lm-note-form textarea{width:100%;min-height:78px;resize:vertical;border:1px solid var(--rule2);border-radius:7px;padding:9px 10px;font:400 14px/1.5 'Newsreader';color:var(--ink);background:var(--panel);outline:none}
.lm-note-form textarea:focus{border-color:var(--accent)}
.lm-note-tagin{width:100%;margin-top:8px;border:1px solid var(--rule2);border-radius:7px;padding:7px 10px;font:500 12.5px 'Archivo';color:var(--ink);background:var(--panel);outline:none}
.lm-note-tagin:focus{border-color:var(--accent)}
.lm-note-save{margin-top:9px;width:100%;font:700 12px 'Archivo';letter-spacing:.05em;text-transform:uppercase;color:#fff;background:var(--accent);border:0;border-radius:7px;padding:9px;cursor:pointer;transition:.14s}
.lm-note-save:hover{filter:brightness(1.12)}
.lm-note-save:disabled{opacity:.4;cursor:default}
.lm-note{border:1px solid var(--rule2);border-left:3px solid var(--accent);border-radius:9px;background:#fff;padding:11px 12px;margin-top:9px}
.lm-note-text{font:400 14px/1.55 'Newsreader';color:var(--ink);white-space:pre-wrap}
.lm-note-foot{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.lm-note-tag{font:700 10px 'Archivo';letter-spacing:.04em;color:var(--accent);background:var(--sel);border-radius:5px;padding:2px 7px}
.lm-note-ts{margin-left:auto;font:500 10px 'Archivo';color:var(--faint)}
.lm-note-del{font:700 13px 'Archivo';color:var(--faint);background:none;border:0;cursor:pointer;line-height:1}
.lm-note-del:hover{color:var(--gc)}
@media(max-width:1180px){
  .lm-body{grid-template-columns:minmax(0,1fr) 408px}
  .lm-left{display:none}
  .lm-sum-inline{display:block;max-width:680px;margin:0 auto 18px;background:var(--panel2);border:1px solid var(--rule2);border-radius:12px;padding:15px 17px}
  .lm-sum-inline .lm-sum{font-size:14px}
}
.lm-sheet-backdrop{display:none}
@media(max-width:880px){
  .lm-body{grid-template-columns:1fr}
  .lm-rail{position:fixed;left:0;right:0;bottom:0;max-height:74vh;border-left:0;border-top:1px solid var(--rule2);box-shadow:0 -10px 30px rgba(42,37,31,.18);transform:translateY(102%);transition:transform .3s cubic-bezier(.3,.8,.3,1);z-index:40;border-radius:16px 16px 0 0}
  .lm-rail.open{transform:none}
  .lm-read{padding:16px 16px 74vh}
  .lm-sheet-backdrop{display:block;position:fixed;inset:0;background:rgba(42,37,31,.34);z-index:39;animation:fade .2s both}
  .lm-handlebar{display:flex;align-items:center;justify-content:center;position:relative;padding:11px 0 9px;cursor:pointer;border-bottom:1px solid var(--rule)}
  .lm-handlebar .grip{width:42px;height:5px;border-radius:3px;background:var(--rule2)}
  .lm-sheet-close{position:absolute;right:12px;top:50%;transform:translateY(-50%);font:700 22px/1 'Archivo';color:var(--muted);background:none;border:0;cursor:pointer;padding:4px 8px}
  .lm-sheet-close:hover{color:var(--ink)}
}
@media(min-width:881px){.lm-handlebar,.lm-sheet-backdrop{display:none}}
.lm-pp{flex:1;overflow-y:auto;padding:30px 30px 110px}
.lm-pp-inner{max-width:760px;margin:0 auto}
.lm-pp-bc{display:flex;align-items:center;gap:7px;font:600 11px 'Archivo';letter-spacing:.04em;color:var(--faint);margin-bottom:14px;flex-wrap:wrap}
.lm-pp-bc button{font:inherit;color:var(--accent);background:none;border:0;cursor:pointer;padding:0}
.lm-pp-bc button:hover{text-decoration:underline}
.lm-pp-bc .sep{color:var(--rule2)}
.lm-pp-kick{font:700 10px 'Archivo';letter-spacing:.16em;text-transform:uppercase;color:var(--selbar)}
.lm-pp-name{font:500 40px/1.05 'Fraunces';letter-spacing:-.015em;margin:7px 0 6px}
.lm-pp-meta{font:600 11.5px 'Archivo';letter-spacing:.04em;color:var(--muted)}
.lm-pp-sec{margin-top:30px}
.lm-pp-h{font:700 11px 'Archivo';letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:11px;display:flex;align-items:center;gap:8px}
.lm-pp-h .n{margin-left:auto;color:var(--faint)}
.lm-def{font:400 16.5px/1.66 'Newsreader';color:var(--ink);background:var(--panel);border:1px solid var(--rule2);border-left:3px solid var(--selbar);border-radius:10px;padding:16px 18px;white-space:pre-wrap}
.lm-def-empty{font:400 14.5px/1.6 'Newsreader';font-style:italic;color:var(--faint);background:var(--panel);border:1px dashed var(--rule2);border-radius:10px;padding:16px 18px}
.lm-def-edit{display:flex;flex-direction:column;gap:8px}
.lm-def-edit textarea{width:100%;min-height:110px;resize:vertical;border:1px solid var(--rule2);border-radius:9px;padding:12px 13px;font:400 16px/1.6 'Newsreader';color:var(--ink);background:#fff;outline:none}
.lm-def-edit textarea:focus{border-color:var(--accent)}
.lm-def-row{display:flex;gap:8px}
.lm-btn{font:700 11.5px 'Archivo';letter-spacing:.04em;border-radius:7px;padding:8px 14px;cursor:pointer;border:1px solid var(--rule2);background:#fff;color:var(--ink);transition:.14s}
.lm-btn:hover{border-color:var(--accent)}
.lm-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.lm-btn.primary:hover{filter:brightness(1.12)}
.lm-pp-tree{display:flex;flex-wrap:wrap;gap:8px}
.lm-pcard{text-align:left;background:#fff;border:1px solid var(--rule2);border-left:3px solid var(--selbar);border-radius:9px;padding:11px 14px;cursor:pointer;transition:.14s;min-width:180px}
.lm-pcard:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:0 4px 12px rgba(42,37,31,.08)}
.lm-pcard .nm{font:500 16px 'Fraunces'}
.lm-pcard .rl{font:600 10px 'Archivo';letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-top:3px}
.lm-vrow{display:block;width:100%;text-align:left;background:#fff;border:1px solid var(--rule2);border-radius:9px;padding:11px 14px;margin-bottom:7px;cursor:default;transition:.14s}
.lm-vrow.tappable{cursor:pointer}
.lm-vrow.tappable:hover{border-color:var(--accent);transform:translateY(-1px)}
.lm-vrow-ref{display:flex;align-items:center;gap:8px;font:600 12.5px 'Archivo';color:var(--accent);margin-bottom:4px}
.lm-vrow-here{font:700 9px 'Archivo';letter-spacing:.05em;background:var(--sel);color:var(--selbar);border-radius:5px;padding:1px 6px}
.lm-vrow-t{font:400 14.5px/1.55 'Newsreader';color:var(--muted)}
.lm-caveat{font:400 12px/1.5 'Newsreader';font-style:italic;color:var(--faint);margin:2px 0 12px}
.lm-pp-back{display:inline-flex;align-items:center;gap:6px;font:700 11px 'Archivo';letter-spacing:.05em;text-transform:uppercase;color:var(--accent);background:none;border:0;cursor:pointer;margin-bottom:6px}
`;

function CrossRefChip({id,onNav}){const r=parseRef(id),internal=inChapter(id);
  if(internal)return <button className="lm-chip" onClick={()=>onNav(verseNumFromId(id))} title="In this chapter — tap to read"><span className="vtag" style={{background:"var(--selbar)"}}>v{r.verse}</span>{r.label}</button>;
  return <span className="lm-chip ext" title={`${r.label} · ${r.vol} (not loaded in this snapshot)`}><span className="vtag" style={{background:VOL_COLOR[r.vol]||"#999"}}>{r.vol}</span>{r.label}</span>;}

function Section({cat,items,render,filters,canon}){const[open,setOpen]=useState(false);
  if(!filters[cat]||!items.length)return null;const c=CATS[cat],CAP=8,shown=open?items:items.slice(0,CAP);
  return(<div className={`lm-sec${canon?" canon":""}`}><div className="lm-sec-h"><span className="lm-dot" style={{background:c.color}}/>{c.label}<span className="n">{items.length}</span></div>
    <div className="lm-chips">{shown.map(render)}</div>
    {items.length>CAP&&<button className="lm-more" onClick={()=>setOpen(o=>!o)}>{open?"Show fewer":`Show all ${items.length}`}</button>}</div>);}

function Timeline({talks}){const yrs=talks.map(t=>t.year);const min=Math.min(...yrs,1985),max=Math.max(...yrs,new Date().getFullYear()),span=Math.max(max-min,1);
  return(<div className="lm-tl"><div className="lm-tl-line"/>{talks.map(t=>{const left=((t.year-min)/span)*100;
    return <div key={t.id} className="lm-tl-pt" style={{left:`${left}%`}} title={`${t.speaker} · ${t.dateLabel}`}><div className="lm-tl-dot"/><div className="lm-tl-yr">{t.year}</div></div>;})}</div>);}

function StudyPane({summary,onPivot,onPrinciple}){
  const chip=(x,type)=>(<button key={x.id} className="lm-rollchip" style={{borderLeftColor:CATS[type==="principle"?"principle":type==="person"?"person":"place"].color}} onClick={()=>onPivot(x.id,x.name,type)}>{x.name}</button>);
  return(<>
    <h4>Chapter summary</h4>
    <p className="lm-sum">{summary.text}</p>
    <h4 className="mt">Themes</h4>
    <div className="lm-theme">{summary.themes.map(t=><span key={t}>{t}</span>)}</div>
    <h4 className="mt">Principles featured</h4>
    <div className="lm-roll">{summary.principles.map(p=>(<button key={p.id} className="lm-rollchip" style={{borderLeftColor:CATS.principle.color}} onClick={()=>onPrinciple(p.id)}>{p.name}</button>))}</div>
    <h4 className="mt">People</h4>
    <div className="lm-roll">{summary.people.map(p=>chip(p,"person"))}</div>
    <h4 className="mt">Places</h4>
    <div className="lm-roll">{summary.places.map(p=>chip(p,"place"))}</div>
    <h4 className="mt">Reading the margin</h4>
    <p className="lm-note-stub" style={{margin:0}}>The bar down the left margin shows each verse's connection density — fainter tan for sparse verses, deep garnet for hubs. It tracks the legend toggles, so switching a layer off recolors the heat.</p>
  </>);
}

function Notes({verseN, notes, onAdd, onDelete}){
  const [text,setText]=useState(""); const [tags,setTags]=useState("");
  const save=()=>{ if(!text.trim())return;
    onAdd(verseN,{ id:`${Date.now()}`, text:text.trim(), tags:tags.split(",").map(s=>s.trim()).filter(Boolean), ts:new Date() });
    setText(""); setTags(""); };
  return(<>
    <div className="lm-rail-ref">Notes · {CHAPTER.ref}:{verseN}</div>
    <div className="lm-note-stub">Stub — notes are kept for this session. Wiring the storage API makes them permanent and graphable.</div>
    <div className="lm-note-form">
      <textarea placeholder={`Your note on verse ${verseN}…`} value={text} onChange={e=>setText(e.target.value)}/>
      <input className="lm-note-tagin" placeholder="tags, comma separated (e.g. obedience, temple typology)" value={tags} onChange={e=>setTags(e.target.value)}/>
      <button className="lm-note-save" disabled={!text.trim()} onClick={save}>Save note</button>
    </div>
    {notes.length===0
      ? <div className="lm-empty">No notes on this verse yet.</div>
      : notes.map(nt=>(<div key={nt.id} className="lm-note">
          <div className="lm-note-text">{nt.text}</div>
          <div className="lm-note-foot">
            {nt.tags.map(tg=><span key={tg} className="lm-note-tag">#{tg}</span>)}
            <span className="lm-note-ts">{nt.ts.toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span>
            <button className="lm-note-del" title="Delete" onClick={()=>onDelete(verseN,nt.id)}>×</button>
          </div>
        </div>))}
  </>);
}


// ---- LAYOUT STRATEGY 1: radial (deterministic, for the local ego view) ----
function layoutRadial(topo){
  const {dims}=topo; const {cx,cy,R1,R2}=dims;
  const out=topo.nodes.map(n=>({...n}));
  const focus=out.find(n=>n.depth===0); if(focus){focus.x=cx;focus.y=cy;}
  const d1=out.filter(n=>n.depth===1);
  d1.forEach((n,i)=>{ const a=(-90+360/Math.max(d1.length,1)*i)*Math.PI/180; n.ang=a; n.x=cx+R1*Math.cos(a); n.y=cy+R1*Math.sin(a); });
  const d2=out.filter(n=>n.depth===2);
  const groups={}; d2.forEach(n=>{ (groups[n.parentId]=groups[n.parentId]||[]).push(n); });
  Object.entries(groups).forEach(([pid,kids])=>{ const par=out.find(n=>n.id===pid); const base=par&&par.ang!=null?par.ang:0;
    kids.forEach((n,j)=>{ const off=(j-(kids.length-1)/2)*(20*Math.PI/180); const a=base+off; n.x=cx+R2*Math.cos(a); n.y=cy+R2*Math.sin(a); }); });
  d2.forEach((n,i)=>{ if(n.x==null){ const a=(-90+360/Math.max(d2.length,1)*i)*Math.PI/180; n.x=cx+R2*Math.cos(a); n.y=cy+R2*Math.sin(a);} });
  return out;
}

// ---- RENDERER: pure SVG, draws whatever positioned nodes/links it is handed ----
function GraphCanvas({ nodes, links, dims, focusKey, onRecenter, animate }){
  const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
  const trunc=(t)=>t&&t.length>17?t.slice(0,16)+"\u2026":t;
  const rad=(n)=>n.depth===0?26:n.type==="more"?11:n.depth===1?18:13;
  return (
    <svg viewBox={`0 0 ${dims.W} ${dims.H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <g key={animate?focusKey:undefined} className={animate?"gfade":""}>
        {links.map((l,i)=>{ const a=byId[l.a],b=byId[l.b]; if(!a||!b||a.x==null||b.x==null)return null; const d2=a.depth===2||b.depth===2;
          return <line key={i} className="lm-gedge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={d2?1.1:1.5} strokeDasharray={d2?"3 3":"0"} opacity={d2?0.65:1}/>; })}
        {nodes.map(n=>{ if(n.x==null)return null; const r=rad(n); const click=n.recenterable&&n.depth!==0;
          return (<g key={n.id} className={`lm-gnode ${click?"click":""}`} onClick={click?()=>onRecenter(n):undefined}>
            <circle cx={n.x} cy={n.y} r={r} fill={n.color} stroke={n.depth===0?"#ffffff":"#f4ecdb"} strokeWidth={n.depth===0?3:2} fillOpacity={n.type==="xverse"||n.type==="more"?0.55:1}/>
            <text className="lm-glabel" x={n.x} y={n.y+r+12} textAnchor="middle">{trunc(n.label)}</text>
          </g>); })}
      </g>
    </svg>
  );
}

// ---- LAYOUT STRATEGY 2: force simulation (emergent, the same engine as Obsidian's view) ----
function ForceLayout({ topology, onRecenter, reheatRef }){
  const [,bump]=useState(0);
  const nodesRef=useRef([]);
  const simRef=useRef(null);
  useEffect(()=>{
    const {dims}=topology;
    const nodes=topology.nodes.map(n=>({...n}));
    const focus=nodes.find(n=>n.depth===0);
    if(focus){ focus.fx=dims.cx; focus.fy=dims.cy; focus.x=dims.cx; focus.y=dims.cy; }
    nodes.forEach((n,i)=>{ if(n.depth!==0){ const a=i/Math.max(nodes.length,1)*2*Math.PI; n.x=dims.cx+Math.cos(a)*90; n.y=dims.cy+Math.sin(a)*90; } });
    const simLinks=topology.links.map(l=>({source:l.a,target:l.b}));
    const sim=d3.forceSimulation(nodes)
      .force("charge",d3.forceManyBody().strength(-260))
      .force("link",d3.forceLink(simLinks).id(d=>d.id).distance(d=>(d.source.depth===0||d.target.depth===0)?78:58).strength(0.5))
      .force("x",d3.forceX(dims.cx).strength(0.05))
      .force("y",d3.forceY(dims.cy).strength(0.05))
      .force("collide",d3.forceCollide(n=>(n.depth===0?34:24)))
      .velocityDecay(0.3)
      .on("tick",()=>{ nodesRef.current=nodes; bump(b=>b+1); });
    simRef.current=sim; nodesRef.current=nodes;
    reheatRef.current=()=>sim.alpha(0.9).restart();
    return ()=>{ sim.stop(); reheatRef.current=()=>{}; };
  },[topology]);
  return <GraphCanvas nodes={nodesRef.current} links={topology.links} dims={topology.dims} focusKey={topology.focusId} onRecenter={onRecenter} animate={false}/>;
}

function LocalGraph({ topology, focus, depth, setDepth, onRecenter, onBack, canBack, onJump, onClose }){
  const [mode,setMode]=useState("radial");   // "radial" | "force"
  const reheatRef=useRef(()=>{});
  const {dims}=topology;
  // legend computed from stable topology (not per force-tick)
  const legend=[]; const seen=new Set();
  topology.nodes.forEach(n=>{ if(n.depth===0||n.type==="more")return; if(seen.has(n.type))return; seen.add(n.type); legend.push({type:n.type,color:n.color,label:TYPE_LEGEND[n.type]||n.type}); });
  const radialNodes=useMemo(()=>layoutRadial(topology),[topology]);
  return (
    <div className="lm-reader-ov" onClick={onClose}>
      <div className="lm-graph-card" onClick={e=>e.stopPropagation()}>
        <div className="lm-graph-head">
          <div>
            <div className="lm-graph-kick">Local graph \u00b7 {mode==="force"?"force layout":"radial layout"} \u00b7 depth {depth}</div>
            <div className="lm-graph-title">{focusLabelText(focus)}</div>
          </div>
          <div className="lm-graph-ctrl">
            {canBack && <button className="lm-gbtn ghost" onClick={onBack}>\u2190 Back</button>}
            {focus.type==="verse" && <button className="lm-gbtn" onClick={onJump}>Read this verse</button>}
            <span className="lm-depth">Layout
              <span className="seg">
                <button className={mode==="radial"?"on":""} onClick={()=>setMode("radial")}>Radial</button>
                <button className={mode==="force"?"on":""} onClick={()=>setMode("force")}>Force</button>
              </span>
            </span>
            <span className="lm-depth">Depth
              <span className="seg">
                <button className={depth===1?"on":""} onClick={()=>setDepth(1)}>1</button>
                <button className={depth===2?"on":""} onClick={()=>setDepth(2)}>2</button>
              </span>
            </span>
            {mode==="force" && <button className="lm-gbtn" onClick={()=>reheatRef.current()}>\u21bb Replay</button>}
            <button className="lm-graph-x" onClick={onClose}>\u00d7</button>
          </div>
        </div>
        <div className="lm-graph-svgwrap">
          {mode==="radial"
            ? <GraphCanvas nodes={radialNodes} links={topology.links} dims={dims} focusKey={topology.focusId} onRecenter={onRecenter} animate={true}/>
            : <ForceLayout topology={topology} onRecenter={onRecenter} reheatRef={reheatRef}/>}
        </div>
        <div className="lm-graph-legend">
          {legend.map(l=><span key={l.type}><i style={{background:l.color}}/>{l.label}</span>)}
        </div>
        <div className="lm-graph-foot">{mode==="force"
          ? "Force layout: nodes repel, edges pull like springs, and the system settles into equilibrium \u2014 watch it converge, or hit Replay to re-run. Same engine Obsidian uses for its global view."
          : "Radial layout: the focus sits at center, neighbors on rings by depth \u2014 deterministic and legible for a single-focus neighborhood. Same connections as the rail, drawn as space."}</div>
      </div>
    </div>
  );
}
function focusLabelText(f){ if(f.type==="verse") return `${CHAPTER.ref}:${f.key}`; return NAME[f.key]||f.key; }

function Badge({prov,license}){
  return (<>
    {prov && <span className="lm-badge" style={{background:PROV_COLOR[prov]+"22",color:PROV_COLOR[prov]}}>{PROV_LABEL[prov]}</span>}
    {license && <span className="lm-badge lic">{license}</span>}
  </>);
}

function CollectionsManager({ colState, setEnabled, setPinned, onClose }){
  const tiers=["canon","app","community","personal"];
  return (
    <div className="lm-mgr-ov" onClick={onClose}>
      <div className="lm-mgr" onClick={e=>e.stopPropagation()}>
        <div className="lm-mgr-top"><div className="lm-mgr-title">Collections</div><button className="lm-mgr-x" onClick={onClose}>×</button></div>
        <div className="lm-mgr-sub">Each collection is a layer of connections over the same verses. Toggle which authorities you see; pin the ones you always want on top. Public-domain layers store full text; copyrighted layers store a link.</div>
        {tiers.map(tier=>{
          const rows=COLLECTIONS.filter(c=>c.tier===tier);
          if(!rows.length) return null;
          return (<div key={tier}>
            <div className="lm-mgr-tier">{TIER_LABEL[tier]}</div>
            {rows.map(c=>{ const st=colState[c.id]; const locked=c.tier==="canon";
              return (<div key={c.id} className="lm-mgr-row">
                <span className="sw" style={{background:c.color}}/>
                <div className="body">
                  <div className="nm">{c.name}
                    <button className={`lm-pin ${st.pinned?"on":""}`} title="Pin to top" onClick={()=>setPinned(c.id,!st.pinned)}>{st.pinned?"★ pinned":"☆ pin"}</button></div>
                  <div className="meta"><Badge prov={c.provenance} license={c.license}/>
                    <span className="lm-store">{c.storage==="prose"?"stores full text":c.storage==="link"?"link only":"facts only"}</span></div>
                  <div className="note">{c.note}</div>
                </div>
                <button className={`lm-sw ${st.enabled?"on":""} ${locked?"locked":""}`} title={locked?"Canonical layer — always on":"Toggle"}
                  onClick={()=>!locked&&setEnabled(c.id,!st.enabled)}/>
              </div>); })}
          </div>);
        })}
      </div>
    </div>
  );
}

function PrinciplePage({ id, chapter, defs, defEdit, setDefEdit, onSaveDef, onPrinciple, onVerse, onBack, hasBack }){
  const name = PRINCIPLE_NAME[id] || id;
  const node = PRINCIPLES[id] || { verseCount:null, parents:[], children:[], verses:[] };
  const graphDef = null; // description is null in the graph for all principles
  const userDef = defs[id];
  const def = userDef || graphDef;
  const [draft,setDraft] = useState(userDef || "");

  // in-chapter appearances computed live from the chapter (always real)
  const here = chapter.verses.filter(v=>v.pr.some(x=>x.id===id));
  const parents=(node.parents||[]).map(pid=>({id:pid,name:PRINCIPLE_NAME[pid]||pid}));
  const children=(node.children||[]).map(cid=>({id:cid,name:PRINCIPLE_NAME[cid]||cid}));

  return (
    <div className="lm-pp"><div className="lm-pp-inner">
      <button className="lm-pp-back" onClick={onBack}>← {hasBack?"Back":"Back to reading"}</button>
      {parents.length>0 && (
        <div className="lm-pp-bc">{parents.map((pp,i)=>(<React.Fragment key={pp.id}>
          {i>0&&<span className="sep">·</span>}<button onClick={()=>onPrinciple(pp.id)}>{pp.name}</button></React.Fragment>))}
          <span className="sep">▸</span><span style={{color:"var(--ink)"}}>{name}</span></div>)}

      <div className="lm-pp-kick">Principle</div>
      <h1 className="lm-pp-name">{name}</h1>
      <div className="lm-pp-meta">{node.verseCount!=null?`${node.verseCount} verses in canon`:"verse count loads from graph"} · appears ×{here.length} in this chapter</div>

      <div className="lm-pp-sec">
        <div className="lm-pp-h">Definition {def&&<button className="lm-btn" style={{marginLeft:"auto",padding:"4px 10px"}} onClick={()=>{setDraft(userDef||"");setDefEdit(true);}}>Edit</button>}</div>
        {defEdit ? (
          <div className="lm-def-edit">
            <textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder={`Define "${name}" — how you understand it, its scriptural shape, its covenant context…`}/>
            <div className="lm-def-row">
              <button className="lm-btn primary" disabled={!draft.trim()} onClick={()=>onSaveDef(id,draft.trim())}>Save definition</button>
              <button className="lm-btn" onClick={()=>setDefEdit(false)}>Cancel</button>
            </div>
          </div>
        ) : def ? (
          <div className="lm-def">{def}</div>
        ) : (
          <div className="lm-def-empty">No definition in the graph yet — the principle node's description is empty. Write your own and it becomes part of your study layer.
            <div style={{marginTop:11}}><button className="lm-btn primary" onClick={()=>{setDraft("");setDefEdit(true);}}>Write a definition</button></div>
          </div>
        )}
      </div>

      {children.length>0 && (
        <div className="lm-pp-sec">
          <div className="lm-pp-h">Child principles <span className="n">{children.length}</span></div>
          <div className="lm-pp-tree">{children.map(c=>(
            <button key={c.id} className="lm-pcard" onClick={()=>onPrinciple(c.id)}>
              <div className="nm">{c.name}</div><div className="rl">Narrows ↓</div></button>))}</div>
        </div>)}

      {parents.length>0 && (
        <div className="lm-pp-sec">
          <div className="lm-pp-h">Broader principle</div>
          <div className="lm-pp-tree">{parents.map(pp=>(
            <button key={pp.id} className="lm-pcard" onClick={()=>onPrinciple(pp.id)}>
              <div className="nm">{pp.name}</div><div className="rl">Climb ↑</div></button>))}</div>
        </div>)}

      {here.length>0 && (
        <div className="lm-pp-sec">
          <div className="lm-pp-h">In this chapter <span className="n">{here.length}</span></div>
          {here.map(v=>(
            <button key={v.n} className="lm-vrow tappable" onClick={()=>onVerse(v.n)}>
              <div className="lm-vrow-ref">{chapter.ref}:{v.n}<span className="lm-vrow-here">in view</span></div>
              <div className="lm-vrow-t">{v.t.length>150?v.t.slice(0,150)+"…":v.t}</div></button>))}
        </div>)}

      <div className="lm-pp-sec">
        <div className="lm-pp-h">References across canon <span className="n">{node.verseCount!=null?node.verseCount:"—"}</span></div>
        {node.verses.length>0 ? (<>
          <div className="lm-caveat">The graph returns these alphabetically and caps at 20, so this is a sample, not the full set — and it can miss the obvious ones (Obedience's list omits 1 Nephi 3:7). The live build will sort by relevance and page through all {node.verseCount}.</div>
          {node.verses.map(v=>{ const here1=v.id.startsWith("1-ne-3-");
            return (<div key={v.id} className={`lm-vrow${here1?" tappable":""}`} onClick={here1?()=>onVerse(parseInt(v.id.split("-").pop(),10)):undefined}>
              <div className="lm-vrow-ref">{v.ref}{here1&&<span className="lm-vrow-here">in view</span>}</div>
              <div className="lm-vrow-t">{v.text}</div></div>); })}
        </>) : (
          <div className="lm-def-empty">Verse list loads from the graph in the live build (this node wasn't pre-seeded in the prototype).</div>
        )}
      </div>
    </div></div>
  );
}

export default function LumenStudyV3(){
  const [sel,setSel]=useState(7);
  const [entity,setEntity]=useState(null);
  const [tab,setTab]=useState("connections");
  const [drawer,setDrawer]=useState(false);
  const [notesByVerse,setNotesByVerse]=useState({});
  const [reader,setReader]=useState(null);
  const [mgrOpen,setMgrOpen]=useState(false);
  const [colState,setColState]=useState(()=>Object.fromEntries(COLLECTIONS.map(c=>[c.id,{enabled:true,pinned:!!c.pinned}])));
  const setEnabled=(id,v)=>setColState(m=>({...m,[id]:{...m[id],enabled:v}}));
  const setPinned=(id,v)=>setColState(m=>({...m,[id]:{...m[id],pinned:v}}));
  const [graphFocus,setGraphFocus]=useState(null);   // {type,key} | null
  const [graphDepth,setGraphDepth]=useState(1);
  const [graphTrail,setGraphTrail]=useState([]);
  const [hoverWord,setHoverWord]=useState(null);
  const [view,setView]=useState("study");          // "study" | {principle:id}
  const [backStack,setBackStack]=useState([]);
  const [defs,setDefs]=useState({});                 // user-authored principle definitions
  const [defEdit,setDefEdit]=useState(false);

  const byNum=useMemo(()=>Object.fromEntries(CHAPTER.verses.map(v=>[v.n,v])),[]);
  const cur=byNum[sel];
  const uniq=(a)=>[...new Set(a)];
  const talksForVerse=(n)=>TALKS.filter(t=>t.cites.includes(n));
  const notesFor=(n)=>notesByVerse[n]||[];
  // Items a collection contributes to verse n (drives both rail sections and heat)
  const colItems=(colId,n)=>{
    const v=byNum[n]; if(!v) return [];
    switch(colId){
      case "crossref": return [...uniq(v.o).map(id=>({k:"o",id})),...uniq(v.i).map(id=>({k:"i",id}))];
      case "principle": return v.pr;
      case "people": return [...v.pe,...v.pl];
      case "gc": return TALKS.filter(t=>t.cites.includes(n));
      case "guide": return Object.entries(GUIDE).filter(([,g])=>g.verses.includes(n)).map(([id,g])=>({id,...g}));
      case "easton": { const ids=new Set([...v.pe,...v.pl].map(x=>x.id));
        return Object.entries(EASTON).filter(([id,e])=>ids.has(id)||e.verses.includes(n)).map(([id,e])=>({id,...e})); }
      case "words": return WORDS[n]||[];
      case "podcast": return PODCAST.filter(e=>e.verses.includes(n));
      case "notes": return notesFor(n);
      default: return [];
    }
  };
  const enabledCols=()=>{
    const on=COLLECTIONS.filter(c=>colState[c.id]?.enabled);
    return on.sort((a,b)=>(colState[b.id].pinned-colState[a.id].pinned));
  };
  const colCount=(n)=>enabledCols().reduce((s,c)=>s+colItems(c.id,n).length,0);

  // ---- local graph: build a radial ego-graph from the same accessors as the rail ----
  const colorOfCol=(id)=>COLLECTIONS.find(c=>c.id===id)?.color||"#999";
  function focusColor(t){ return t==="verse"?"#2a251f":t==="principle"?colorOfCol("principle"):t==="person"||t==="place"?colorOfCol("people"):"#2a251f"; }
  function focusLabel(f){ if(f.type==="verse") return `${CHAPTER.ref}:${f.key}`; return NAME[f.key]||f.key; }
  function neighborsOf(type,key){
    const out=[];
    if(type==="verse"){
      const v=byNum[key]; if(!v) return out;
      enabledCols().forEach(c=>{
        const items=colItems(c.id,key); if(!items.length) return;
        const CAP=5; items.slice(0,CAP).forEach((it,i)=>{
          if(c.id==="crossref"){ const id=it.id, ic=inChapter(id);
            out.push({id:ic?`verse:${verseNumFromId(id)}`:`x:${id}`,label:parseRef(id).label,type:ic?"verse":"xverse",color:ic?"#2a251f":"#9b8e78",recenterable:ic,key:ic?verseNumFromId(id):null}); }
          else if(c.id==="principle"){ out.push({id:`principle:${it.id}`,label:it.name,type:"principle",color:colorOfCol("principle"),recenterable:true,key:it.id}); }
          else if(c.id==="people"){ const isPlace=v.pl.some(x=>x.id===it.id); out.push({id:`${isPlace?"place":"person"}:${it.id}`,label:it.name,type:isPlace?"place":"person",color:colorOfCol("people"),recenterable:true,key:it.id}); }
          else if(c.id==="gc"){ out.push({id:`t:${it.id}`,label:it.speaker.split(" ").slice(-1)[0],type:"talk",color:colorOfCol("gc"),recenterable:false}); }
          else if(c.id==="guide"){ out.push({id:`g:${it.id}`,label:NAME[it.id]||"Guide",type:"guide",color:colorOfCol("guide"),recenterable:false}); }
          else if(c.id==="easton"){ out.push({id:`d:${it.id}`,label:NAME[it.id]||"Entry",type:"dict",color:colorOfCol("easton"),recenterable:false}); }
          else if(c.id==="words"){ out.push({id:`w:${key}:${i}`,label:it.w,type:"word",color:colorOfCol("words"),recenterable:false}); }
          else if(c.id==="podcast"){ out.push({id:`pod:${it.id}`,label:"Podcast",type:"podcast",color:colorOfCol("podcast"),recenterable:false}); }
          else if(c.id==="notes"){ out.push({id:`note:${it.id}`,label:"Note",type:"note",color:colorOfCol("notes"),recenterable:false}); }
        });
        if(items.length>CAP) out.push({id:`more:${c.id}:${key}`,label:`+${items.length-CAP}`,type:"more",color:colorOfCol(c.id),recenterable:false});
      });
    } else if(type==="principle"){
      CHAPTER.verses.filter(v=>v.pr.some(x=>x.id===key)).slice(0,6).forEach(v=>out.push({id:`verse:${v.n}`,label:`${CHAPTER.ref}:${v.n}`,type:"verse",color:"#2a251f",recenterable:true,key:v.n}));
      const node=PRINCIPLES[key];
      if(node) [...(node.parents||[]),...(node.children||[])].forEach(pid=>out.push({id:`principle:${pid}`,label:PRINCIPLE_NAME[pid]||pid,type:"principle",color:colorOfCol("principle"),recenterable:true,key:pid}));
    } else if(type==="person"||type==="place"){
      const fld=type==="person"?"pe":"pl";
      CHAPTER.verses.filter(v=>v[fld].some(x=>x.id===key)).slice(0,8).forEach(v=>out.push({id:`verse:${v.n}`,label:`${CHAPTER.ref}:${v.n}`,type:"verse",color:"#2a251f",recenterable:true,key:v.n}));
    }
    return out;
  }
  // Build TOPOLOGY only (nodes + links, no positions). Layout is applied later
  // by a pluggable strategy (radial | force); the renderer draws whatever it gets.
  function buildTopology(){
    const dims={W:640,H:540,cx:320,cy:262,R1:140,R2:246};
    const f=graphFocus;
    const nodeMap=new Map();
    const focusNode={id:`${f.type}:${f.key}`,label:focusLabel(f),type:f.type,color:focusColor(f.type),depth:0,recenterable:false,key:f.key};
    nodeMap.set(focusNode.id,focusNode);
    const linkSet=new Set(),links=[];
    const addLink=(a,b)=>{ if(a===b)return; const k=[a,b].sort().join("|"); if(!linkSet.has(k)){linkSet.add(k);links.push({a,b});} };
    neighborsOf(f.type,f.key).forEach(nd=>{ if(!nodeMap.has(nd.id)) nodeMap.set(nd.id,{...nd,depth:1}); addLink(focusNode.id,nd.id); });
    if(graphDepth>=2){
      let budget=16;
      [...nodeMap.values()].filter(n=>n.depth===1&&n.recenterable).forEach(parent=>{
        neighborsOf(parent.type,parent.key).slice(0,3).forEach(nd=>{
          if(budget<=0) return;
          if(!nodeMap.has(nd.id)){ nodeMap.set(nd.id,{...nd,depth:2,parentId:parent.id}); budget--; }
          addLink(parent.id,nd.id);
        });
      });
    }
    return {nodes:[...nodeMap.values()],links,dims,focusId:focusNode.id};
  }
  const graphTopology=useMemo(()=>graphFocus?buildTopology():{nodes:[],links:[],dims:{W:640,H:540,cx:320,cy:262,R1:140,R2:246},focusId:null},[graphFocus,graphDepth,colState,notesByVerse]);

  const openGraph=(n)=>{ setGraphTrail([]); setGraphDepth(1); setGraphFocus({type:"verse",key:n}); };
  const graphRecenter=(node)=>{ if(!node.recenterable) return; setGraphTrail(t=>[...t,graphFocus]); setGraphFocus({type:node.type==="xverse"?"verse":node.type,key:node.key}); };
  const graphBack=()=>{ setGraphTrail(t=>{ if(!t.length){return t;} const nx=t.slice(0,-1); setGraphFocus(t[t.length-1]); return nx; }); };
  const graphJump=()=>{ if(graphFocus&&graphFocus.type==="verse"){ setEntity(null); setSel(graphFocus.key); setGraphFocus(null);} };
  // word-level Strong's hover (desktop). Each word becomes an addressable span;
  // mapped words pop a lemma card. This is the read-time shape of the word layer.
  const lookupStrong=(w)=>STRONGS_STUB[w.toLowerCase().replace(/[^a-z]/g,"")];
  const onWordEnter=(e,word)=>{ const r=e.currentTarget.getBoundingClientRect(); setHoverWord({word,data:lookupStrong(word),x:r.left+r.width/2,y:r.top}); };
  const onWordLeave=()=>setHoverWord(null);
  const renderWords=(text)=>text.split(/([A-Za-z\u2019'-]+)/).map((tok,i)=>{
    if(/^[A-Za-z]/.test(tok)){ const mapped=!!lookupStrong(tok);
      return <span key={i} className={`lm-w${mapped?" mapped":""}`} onMouseEnter={(e)=>onWordEnter(e,tok)} onMouseLeave={onWordLeave}>{tok}</span>; }
    return tok;
  });
  const verseHeat=(v)=>colCount(v.n);
  const maxHeat=Math.max(1,...CHAPTER.verses.map(verseHeat));
  const heatStyle=(v)=>{const h=verseHeat(v);if(!h)return{opacity:0};const it=Math.pow(h/maxHeat,0.6);
    const r=Math.round(202-(202-138)*it),g=Math.round(172-(172-58)*it),b=Math.round(120-(120-58)*it);
    return{background:`rgb(${r},${g},${b})`,opacity:0.28+0.72*it};};

  const memberVerses=useMemo(()=>{
    if(!entity)return[];
    if(entity.type==="speaker")return CHAPTER.verses.filter(v=>TALKS.some(t=>t.speaker===entity.id&&t.cites.includes(v.n))).map(v=>v.n);
    const key=entity.type==="principle"?"pr":entity.type==="person"?"pe":"pl";
    return CHAPTER.verses.filter(v=>v[key].some(x=>x.id===entity.id)).map(v=>v.n);
  },[entity]);
  const memberSet=useMemo(()=>new Set(memberVerses),[memberVerses]);

  const selectVerse=(n)=>{setEntity(null);setSel(n);setDrawer(true);};
  const openEntity=(id,name,type)=>{setEntity({id,name,type});setDrawer(true);};
  const openSpeaker=(t)=>{setEntity({id:t.speaker,name:t.speaker,type:"speaker",office:t.office});setDrawer(true);};
  const openPrinciple=(id)=>{ setBackStack(b=>[...b,view]); setDefEdit(false); setEntity(null); setView({principle:id}); };
  const goBack=()=>{ setBackStack(b=>{ if(!b.length){ setView("study"); return b; } const nx=b.slice(0,-1); setView(b[b.length-1]); return nx; }); setDefEdit(false); };
  const toStudyVerse=(n)=>{ setBackStack([]); setView("study"); setEntity(null); setSel(n); setDrawer(true); setDefEdit(false); };
  const saveDef=(id,text)=>{ setDefs(d=>({...d,[id]:text})); setDefEdit(false); };
  const addNote=(n,note)=>setNotesByVerse(m=>({...m,[n]:[note,...(m[n]||[])]}));
  const delNote=(n,id)=>setNotesByVerse(m=>({...m,[n]:(m[n]||[]).filter(x=>x.id!==id)}));

  return(
    <div className="lm-root"><style>{CSS}</style>
      <header className="lm-head">
        <div className="lm-kicker">Lumen · Study Surface · canon graph · Conference · notes</div>
        <h1 className="lm-title">1 Nephi <em>3</em></h1>
        <p className="lm-sub">{CHAPTER.subtitle}</p>
        <div className="lm-legend">
          {COLLECTIONS.map(c=>(
            <button key={c.id} className={`lm-chipf ${colState[c.id]?.enabled?"":"off"}`}
              onClick={()=>c.tier!=="canon"&&setEnabled(c.id,!colState[c.id].enabled)}
              title={c.tier==="canon"?"Canonical — always on":"Toggle layer"}>
              <span className="lm-dot" style={{background:c.color}}/>{c.name}{colState[c.id]?.pinned&&<span style={{color:"var(--selbar)"}}>★</span>}
            </button>))}
          <button className="lm-mgr-btn" onClick={()=>setMgrOpen(true)}>⚙ Manage collections</button>
        </div>
      </header>

      {view!=="study" && view.principle ? (
        <PrinciplePage id={view.principle} chapter={CHAPTER} defs={defs} defEdit={defEdit} setDefEdit={setDefEdit}
          onSaveDef={saveDef} onPrinciple={openPrinciple} onVerse={toStudyVerse} onBack={goBack} hasBack={backStack.length>0}/>
      ) : (
      <div className="lm-body">
        <div className="lm-left"><StudyPane summary={CHAPTER.summary} onPivot={openEntity} onPrinciple={openPrinciple}/></div>

        <div className="lm-read">
          <div className="lm-read-inner">
            <div className="lm-sum-inline"><h4 style={{font:"700 10.5px 'Archivo'",letterSpacing:".14em",textTransform:"uppercase",color:"var(--faint)",margin:"0 0 8px"}}>Chapter summary</h4><p className="lm-sum">{CHAPTER.summary.text}</p></div>
            {CHAPTER.verses.map((v,idx)=>{
              const nc=notesFor(v.n).length;
              const count=colCount(v.n);
              const cls=["lm-v"];
              if(!entity&&v.n===sel)cls.push("sel");
              if(entity){if(memberSet.has(v.n))cls.push(entity.type==="speaker"?"gcmember":"member");else cls.push("dim");}
              return(<button key={v.n} className={cls.join(" ")} style={{animationDelay:`${Math.min(idx*22,500)}ms`}} onClick={()=>selectVerse(v.n)}>
                <span className="lm-heat" style={heatStyle(v)} title={`${verseHeat(v)} connections`}/><span className="num">{v.n}</span>{renderWords(v.t)}
                <span className="tags">{enabledCols().filter(c=>c.id!=="notes"&&c.id!=="crossref"&&c.id!=="principle"&&c.id!=="people"&&colItems(c.id,v.n).length).map(c=><i key={c.id} style={{background:c.color}}/>)}</span>
                {nc>0&&<span className="note">✎{nc}</span>}
                <span className="cc">{count}</span>
              </button>);
            })}
          </div>
        </div>

        {drawer && <div className="lm-sheet-backdrop" onClick={()=>setDrawer(false)}/>}
        <aside className={`lm-rail ${drawer?"open":""}`}>
          <div className="lm-handlebar" onClick={()=>setDrawer(false)}><span className="grip"/><button className="lm-sheet-close" aria-label="Close" onClick={(e)=>{e.stopPropagation();setDrawer(false);}}>×</button></div>
          {!entity && (
            <div className="lm-tabs">
              <button className={`lm-tab ${tab==="connections"?"on":""}`} onClick={()=>setTab("connections")}>Connections</button>
              <button className={`lm-tab ${tab==="notes"?"on":""}`} onClick={()=>setTab("notes")}>Notes{notesFor(sel).length>0&&<span className="b">{notesFor(sel).length}</span>}</button>
            </div>
          )}
          <div className="lm-rail-scroll">
            {entity ? (
              entity.type==="speaker" ? (<>
                <button className="lm-back" onClick={()=>setEntity(null)}>← Back</button>
                <div className="lm-ent-card" style={{borderLeft:`3px solid ${CATS.gc.color}`}}><div className="lm-ent-type" style={{color:CATS.gc.color}}>General Conference speaker</div><div className="lm-ent-name">{entity.name}</div><div className="lm-ent-role">{entity.office}</div></div>
                <div className="lm-ent-h">Cites in this chapter</div>
                <div className="lm-vchips">{memberVerses.map(n=><button key={n} className="lm-vchip" onClick={()=>selectVerse(n)}>v{n}</button>)}</div>
                <div className="lm-ent-h">Talks in this snapshot</div>
                {TALKS.filter(t=>t.speaker===entity.id).map(t=>(<div key={t.id} className="lm-gc"><div className="lm-gc-top"><span className="lm-gc-speaker" style={{cursor:"default"}}>{t.title}</span><span className="lm-gc-date">{t.dateLabel}</span></div><div className="lm-gc-frame">{t.framing}</div><div className="lm-gc-acts"><button className="lm-gc-readbtn" onClick={()=>setReader(t)}>Read in app</button><a className="lm-gc-link" href={t.url} target="_blank" rel="noreferrer">Open on church site ↗</a></div></div>))}
              </>) : (<>
                <button className="lm-back" onClick={()=>setEntity(null)}>← Back</button>
                <div className="lm-ent-card" style={{borderLeft:`3px solid ${CATS[entity.type].color}`}}><div className="lm-ent-type" style={{color:CATS[entity.type].color}}>{entity.type==="principle"?"Principle":entity.type==="person"?"Person":"Place"}</div><div className="lm-ent-name">{entity.name}</div><div className="lm-ent-role">{ENTITY_ROLE[entity.id]||""}</div></div>
                <div className="lm-ent-h">Appears in {memberVerses.length} verse{memberVerses.length!==1?"s":""} here</div>
                {memberVerses.length>0 ? <div className="lm-vchips">{memberVerses.map(n=><button key={n} className="lm-vchip" onClick={()=>selectVerse(n)}>v{n}</button>)}</div>
                  : <div className="lm-note-stub">Not named at the verse level in this chapter — surfaced only by the chapter summary's semantic layer.</div>}
              </>)
            ) : tab==="notes" ? (
              <Notes verseN={sel} notes={notesFor(sel)} onAdd={addNote} onDelete={delNote}/>
            ) : cur ? (<>
              <div className="lm-rail-ref">{CHAPTER.ref}:{cur.n}<button className="lm-graphbtn" onClick={()=>openGraph(cur.n)}>◈ Local graph</button></div>
              <div className="lm-rail-meta">{colCount(cur.n)} connections across {enabledCols().filter(c=>colItems(c.id,cur.n).length).length} collections</div>
              <p className="lm-rail-quote">{cur.t}</p>
              {enabledCols().map(c=>{
                const items=colItems(c.id,cur.n);
                if(c.id==="notes") return null; // notes live in their own tab
                if(!items.length) return null;
                return (
                  <div key={c.id} className="lm-sec">
                    <div className="lm-col-h">
                      <span className="sw" style={{background:c.color}}/>
                      <span className="nm">{c.name}</span>
                      <Badge prov={c.provenance}/>
                      <span className="ct">{items.length}</span>
                    </div>
                    {c.id==="crossref" && <div className="lm-chips">{items.map(it=><CrossRefChip key={it.k+it.id} id={it.id} onNav={selectVerse}/>)}</div>}
                    {c.id==="principle" && <div className="lm-chips">{items.map(pp=><button key={pp.id} className="lm-chip entity" style={{borderLeftColor:c.color}} onClick={()=>openPrinciple(pp.id)}>{pp.name}</button>)}</div>}
                    {c.id==="people" && <div className="lm-chips">{items.map(pp=><button key={pp.id} className="lm-chip entity" style={{borderLeftColor:c.color}} onClick={()=>openEntity(pp.id,pp.name,CHAPTER.verses.find(v=>v.n===cur.n).pl.some(x=>x.id===pp.id)?"place":"person")}>{pp.name}</button>)}</div>}
                    {c.id==="gc" && (<><Timeline talks={items}/>{items.map(t=>(<div key={t.id} className="lm-gc"><div className="lm-gc-top"><button className="lm-gc-speaker" onClick={()=>openSpeaker(t)}>{t.speaker}</button><span className="lm-gc-date">{t.dateLabel}</span></div><div className="lm-gc-office">{t.office}</div><div className="lm-gc-title">{t.title}</div><div className="lm-gc-frame">{t.framing}</div><div className="lm-gc-acts"><button className="lm-gc-readbtn" onClick={()=>setReader(t)}>Read in app</button><a className="lm-gc-link" href={t.url} target="_blank" rel="noreferrer">Open on church site ↗</a></div></div>))}</>)}
                    {c.id==="easton" && items.map(e=>(<div key={e.id} className="lm-dict"><div className="lm-dict-term">{PRINCIPLE_NAME[e.id]||e.id.charAt(0).toUpperCase()+e.id.slice(1)}</div><div className="lm-dict-body">{e.entry}</div></div>))}
                    {c.id==="guide" && items.map(g=>(<div key={g.id} className="lm-glink"><div className="lm-glink-term">{PRINCIPLE_NAME[g.id]||g.id}<span className="lm-store">link only</span></div><div className="lm-glink-gloss">{g.gloss}</div><a className="lm-glink-a" href={g.url} target="_blank" rel="noreferrer">Open full entry ↗</a></div>))}
                    {c.id==="words" && <div style={{display:"flex",flexWrap:"wrap"}}>{items.map((w,i)=>(<div key={i} className="lm-word"><span className="wl">{w.w}</span><span className="wlem">{w.lemma}</span><span className="wg">{w.gloss}</span><span className="ws">{w.strong}</span></div>))}</div>}
                    {c.id==="podcast" && items.map(e=>(<div key={e.id} className="lm-gc" style={{borderLeftColor:c.color}}><div className="lm-gc-top"><span className="lm-gc-speaker" style={{cursor:"default",color:c.color}}>{e.host}</span><span className="lm-gc-date">{e.dateLabel}</span></div><div className="lm-gc-title">{e.title}</div><div className="lm-gc-frame">{e.framing}</div><div className="lm-gc-acts"><a className="lm-gc-link" href={e.url} target="_blank" rel="noreferrer">Open episode ↗</a></div></div>))}
                  </div>
                );
              })}
              {colCount(cur.n)===0&&<div className="lm-empty">No connections from your enabled collections.</div>}
            </>) : <div className="lm-empty">Select a verse.</div>}
          </div>
        </aside>
      </div>
      )}

      {mgrOpen===true && (
        <CollectionsManager colState={colState} setEnabled={setEnabled} setPinned={setPinned} onClose={()=>setMgrOpen(false)}/>
      )}
      {graphFocus && (
        <LocalGraph topology={graphTopology} focus={graphFocus} depth={graphDepth} setDepth={setGraphDepth}
          onRecenter={graphRecenter} onBack={graphBack} canBack={graphTrail.length>0}
          onJump={graphJump} onClose={()=>setGraphFocus(null)}/>
      )}

      {hoverWord && (
        <div className="lm-wtip" style={{left:hoverWord.x,top:hoverWord.y}}>
          <div className="surf">{hoverWord.word}</div>
          {hoverWord.data ? (<>
            <div className="lem">{hoverWord.data.heb}</div>
            <div className="translit">{hoverWord.data.translit}</div>
            <div className="row"><span className="sn">{hoverWord.data.strong}</span></div>
            <div className="gloss">{hoverWord.data.gloss}</div>
          </>) : (
            <div className="none">No lemma mapped for this word in the stub.</div>
          )}
          <div className="stub">Strong's · illustrative stub</div>
        </div>
      )}

      {reader && (
        <div className="lm-reader-ov" onClick={()=>setReader(null)}>
          <div className="lm-reader-card" onClick={e=>e.stopPropagation()}>
            <button className="lm-reader-x" onClick={()=>setReader(null)}>×</button>
            <div className="lm-reader-kick">General Conference · {reader.dateLabel}</div>
            <h2 className="lm-reader-title">{reader.title}</h2>
            <div className="lm-reader-by">{reader.speaker} · {reader.office}</div>
            <div className="lm-reader-rule"/>
            <p className="lm-reader-stub">In the live app the full talk streams in here from the source for personal study. The text isn't reproduced in this prototype.</p>
            <p className="lm-reader-frame">{reader.framing}</p>
            <a className="lm-reader-link" href={reader.url} target="_blank" rel="noreferrer">Open original on churchofjesuschrist.org ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}
