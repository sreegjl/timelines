export const sampleData = {
  "file": {
    "id": "planet-trek-timeline",
    "type": "timeline",
    "title": "Planet Trek",
    "start": 4700,
    "end": 5300,
    "maxZoom": 5,
    "negID": "B.C.S.",
    "posID": "A.C.S."
  },
  "elements": [
    {
      "id": "era-post-quantum",
      "type": "era",
      "title": "Post-Quantum Era",
      "start": 4870,
      "end": 4940,
      "color": "#BF7000",
      "tags": ["era", "post-quantum"]
    },
    {
      "id": "era-epherian",
      "type": "era",
      "title": "Epherian Era",
      "start": 4940,
      "end": 5107,
      "color": "#F4D05A",
      "tags": ["era", "epherian"]
    },

    {
      "id": "span-zokya-dynasty",
      "type": "span",
      "title": "Zokya Dynasty",
      "start": 4870,
      "end": 5033,
      "color": "#6C5F55",
      "branches": ["span-hu-fui-alliance"],
      "forks": ["span-costa-empire", "span-hu-naria-empire"],
      "tags": ["dynasty"]
    },
    {
      "id": "span-epherian-dynasty",
      "type": "span",
      "title": "Epherian Dynasty",
      "start": 4870,
      "end": 5107,
      "color": "#2E4C6D",
      "tags": ["dynasty", "epherian"]
    },
    {
      "id": "span-hu-fui-alliance",
      "type": "span",
      "title": "Hu Fui Alliance",
      "start": 4942,
      "end": 5007,
      "color": "#824447",
      "tags": ["alliance"]
    },
    {
      "id": "span-costa-empire",
      "type": "span",
      "title": "Costa Empire",
      "start": 5033,
      "end": 5107,
      "color": "#6C5F55",
      "tags": ["empire"]
    },
    {
      "id": "span-hu-naria-empire",
      "type": "span",
      "title": "Hu Naria Empire",
      "start": 5033,
      "end": 5107,
      "color": "#6C5F55",
      "tags": ["empire"]
    },

    {
      "id": "event-epherian-colonize-oryfn",
      "type": "event",
      "title": "Epherians Colonize Oryfn",
      "date": 4892,
      "parents": ["span-epherian-dynasty"],
      "importance": 4,
      "color": "#C9D9E8",
      "tags": ["colonization"]
    },
    {
      "id": "event-eltusese-supernova",
      "type": "event",
      "title": "Eltusese Supernova",
      "date": 4921,
      "parents": [],
      "importance": 3,
      "color": "#EDE6DA",
      "tags": ["astronomy"]
    },
    {
      "id": "event-invention-of-warp-drive",
      "type": "event",
      "title": "Invention of Warp Drive",
      "date": 4937,
      "parents": ["span-zokya-dynasty"],
      "importance": 5,
      "color": "#F3EDE3",
      "tags": ["technology"]
    },
    {
      "id": "event-laina-peace-treaty",
      "type": "event",
      "title": "Laina Peace Treaty",
      "date": 4962,
      "parents": ["span-epherian-dynasty"],
      "importance": 3,
      "color": "#D4CAB8",
      "tags": ["diplomacy"]
    },
    {
      "id": "event-death-of-hu-fui",
      "type": "event",
      "title": "Death of Hu Fui",
      "date": 4981,
      "parents": ["span-hu-fui-alliance"],
      "importance": 5,
      "color": "#E7C9C3",
      "tags": ["succession"]
    },
    {
      "id": "event-the-seventh-eclipse",
      "type": "event",
      "title": "The Seventh Eclipse",
      "date": 5015,
      "parents": [],
      "importance": 2,
      "color": "#F3EDE3",
      "tags": ["astronomy"]
    },
    {
      "id": "event-nari-prime-invasion",
      "type": "event",
      "title": "Nari Prime Invasion",
      "date": 5044,
      "parents": ["span-costa-empire"],
      "importance": 4,
      "color": "#EDE6DA",
      "tags": ["war"]
    },
    {
      "id": "event-fall-of-inria",
      "type": "event",
      "title": "Fall of Inria",
      "date": 5070,
      "parents": ["span-epherian-dynasty"],
      "importance": 4,
      "color": "#EDE6DA",
      "tags": ["conflict"]
    },
    {
      "id": "event-outbound-explorations",
      "type": "event",
      "title": "Outbound Explorations",
      "date": 5081,
      "parents": ["span-hu-naria-empire"],
      "importance": 3,
      "color": "#EDE6DA",
      "tags": ["exploration"]
    }
  ]
}
