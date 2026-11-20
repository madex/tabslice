export interface DemoScore {
  id: string;
  label: string;
  title: string;
  artist: string;
  summary: string;
  tex: string;
}

export const DEMO_SCORES: DemoScore[] = [
  {
    id: 'ensemble',
    label: 'Ensemble',
    title: 'Midnight Groove',
    artist: 'TabSlice Studio Ensemble',
    summary: '4 Spuren · Lead-Gitarre, Rhythmus-Gitarre, E-Bass & Schlagzeug',
    tex: `\\title "Midnight Groove"
\\subtitle "Multi-Track Ensemble"
\\artist "TabSlice Studio"
\\tempo 112

\\track ("Lead Guitar" "Lead")
  \\staff {score tabs}
  \\instrument 29
  \\tuning (E4 B3 G3 D3 A2 E2)
  \\ts (4 4)
  \\ks G
  :8 0.6 3.6 5.6 7.6{h} 5.6 3.6 5.6 0.6 |
  :8 7.5 5.5 7.5{v} r :8 5.4 7.4 9.4 7.4 |
  :8 8.2 7.2 5.2 7.2 :4 8.2{v} :8 7.2 5.2 |
  :4 7.3{v} :8 5.3 7.3 :2 9.3{v} |
  :8 12.1 10.1 12.1 15.1 :4 12.1{v} :8 10.1 8.1 |
  :8 10.2 8.2 7.2 8.2 :4 10.2{v} :8 8.2 7.2 |
  :8 9.3 7.3 5.3 7.3 :8 9.3 7.3 5.3 4.3 |
  :2 5.4{v} :2 2.4{v}

\\track ("Rhythm Guitar" "Rhy")
  \\staff {score tabs}
  \\instrument 27
  \\tuning (E4 B3 G3 D3 A2 E2)
  \\ts (4 4)
  \\ks G
  :4 (0.6 2.5 2.4 0.3) :8 r (0.6 2.5 2.4 0.3) :4 (0.6 2.5 2.4 0.3) :4 (0.6 2.5 2.4) |
  :4 (3.6 5.5 5.4 4.3) :8 r (3.6 5.5 5.4 4.3) :4 (3.6 5.5 5.4) :4 (2.6 4.5 4.4) |
  :4 (3.5 5.4 5.3 5.2) :8 r (3.5 5.4 5.3) :4 (3.5 5.4 5.3) :4 (2.5 4.4 4.3) |
  :4 (0.5 2.4 2.3 1.2) :8 r (0.5 2.4 2.3) :4 (2.5 4.4 4.3) :4 (2.5 4.4 4.3) |
  :4 (0.6 2.5 2.4 0.3) :8 r (0.6 2.5 2.4 0.3) :4 (0.6 2.5 2.4 0.3) :4 (0.6 2.5 2.4) |
  :4 (3.5 5.4 5.3) :8 r (3.5 5.4 5.3) :4 (5.5 7.4 7.3) :4 (5.5 7.4 7.3) |
  :4 (0.5 2.4 2.3) :4 (2.5 4.4 4.3) :4 (3.5 5.4 5.3) :4 (2.5 4.4 4.3) |
  :2 (0.6 2.5 2.4 0.3) :2 (0.6 2.5 2.4 0.3)

\\track ("Electric Bass" "Bass")
  \\staff {score tabs}
  \\instrument 33
  \\tuning (G2 D2 A1 E1)
  \\ts (4 4)
  \\ks G
  :4 0.4 :8 0.4 0.4 :4 3.4 :8 2.4 0.4 |
  :4 3.4 :8 3.4 3.4 :4 2.4 :8 0.4 2.4 |
  :4 3.3 :8 3.3 3.3 :4 2.3 :8 0.3 2.3 |
  :4 0.3 :8 0.3 0.3 :4 2.3 :8 2.3 0.3 |
  :4 0.4 :8 0.4 3.4 :4 5.4 :8 3.4 2.4 |
  :4 3.3 :8 3.3 3.3 :4 5.3 :8 5.3 3.3 |
  :4 0.3 :4 2.3 :4 3.3 :4 2.3 |
  :2 0.4 :2 0.4

\\track ("Drums" "Dr")
  \\staff {score}
  \\instrument percussion
  \\articulation defaults
  \\ts (4 4)
  :8 ("Crash high (hit)" "Kick (hit)") "Hi-Hat (closed)" ("Snare (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Kick (hit)" "Hi-Hat (closed)") ("Kick (hit)" "Hi-Hat (closed)") ("Snare (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" |
  :8 ("Kick (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Snare (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Kick (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Snare (hit)" "Hi-Hat (closed)") "Hi-Hat (open)" |
  :8 ("Kick (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Snare (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Kick (hit)" "Hi-Hat (closed)") ("Kick (hit)" "Hi-Hat (closed)") ("Snare (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" |
  :8 ("Kick (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Snare (hit)" "Hi-Hat (closed)") "Hi-Hat (closed)" ("Kick (hit)" "Hi-Hat (closed)") "Snare (hit)" "Snare (hit)" "Snare (hit)" |
  :8 ("Crash high (hit)" "Kick (hit)") "Ride (middle)" ("Snare (hit)" "Ride (middle)") "Ride (middle)" ("Kick (hit)" "Ride (middle)") ("Kick (hit)" "Ride (middle)") ("Snare (hit)" "Ride (middle)") "Ride (middle)" |
  :8 ("Kick (hit)" "Ride (middle)") "Ride (middle)" ("Snare (hit)" "Ride (middle)") "Ride (middle)" ("Kick (hit)" "Ride (middle)") "Ride (middle)" ("Snare (hit)" "Ride (middle)") "Ride (middle)" |
  :8 ("Kick (hit)" "Ride (middle)") "Ride (middle)" ("Snare (hit)" "Ride (middle)") "Ride (middle)" ("Kick (hit)" "Ride (middle)") ("Kick (hit)" "Ride (middle)") ("Snare (hit)" "Ride (middle)") "Ride (middle)" |
  :4 ("Crash high (hit)" "Kick (hit)") r :2 ("Crash high (hit)" "Kick (hit)")
`,
  },
  {
    id: 'fingerstyle',
    label: 'Fingerstyle',
    title: 'Autumn Arpeggio',
    artist: 'Acoustic Study No. 4',
    summary: 'Akustikgitarre · Fingerstyle-Arpeggio in e-Moll',
    tex: `\\title "Autumn Arpeggio"
\\artist "Acoustic Study No. 4"
\\tempo 88

\\track ("Acoustic Guitar" "Ac.Gtr")
  \\staff {score tabs}
  \\instrument 25
  \\tuning (E4 B3 G3 D3 A2 E2)
  \\ts (4 4)
  \\ks G
  :8 0.6 2.4 0.3 0.2 0.1 0.2 0.3 2.4 |
  :8 3.5 2.4 0.3 1.2 0.1 1.2 0.3 2.4 |
  :8 3.6 0.4 0.3 0.2 3.1 0.2 0.3 0.4 |
  :8 0.4 2.3 3.2 2.1 3.2 2.3 0.4 2.3 |
  :8 (0.6 0.1) 2.4 0.3 0.2 (2.5 3.1) 0.2 0.3 2.4 |
  :8 (3.5 0.1) 2.4 0.3 1.2 (3.5 3.2) 1.2 0.3 2.4 |
  :8 (0.5 0.1) 2.4 2.3 1.2 (2.5 2.1) 0.2 2.3 1.4 |
  :2 (0.6 2.5 2.4 0.3 0.2 0.1) :2 r
`,
  },
  {
    id: 'blues',
    label: 'Blues Riff',
    title: 'Shuffle Study in A',
    artist: 'Practice Session',
    summary: '2 Spuren · E-Gitarre & Bass zum Üben mit Tempo-Regler und Loop',
    tex: `\\title "Shuffle Study in A"
\\artist "Practice Session"
\\tempo 104

\\track ("Lead Guitar" "Gtr")
  \\staff {score tabs}
  \\instrument 29
  \\tuning (E4 B3 G3 D3 A2 E2)
  \\ts (4 4)
  :8 5.6 8.6 5.5 7.5 5.4 7.4 5.3 7.3 |
  :8 8.2 5.2 7.3 5.3 :4 7.4{v} :4 5.4 |
  :8 5.5 7.5 5.4 7.4 5.3 7.3 8.3 7.3 |
  :4 5.3{v} :8 7.4 5.4 :2 7.5{v} |
  :8 5.1 8.1 5.1 8.2 5.2 8.2 7.3 5.3 |
  :8 7.4 5.4 7.5 5.5 :4 8.6 :4 5.6{v}

\\track ("Walking Bass" "Bass")
  \\staff {score tabs}
  \\instrument 33
  \\tuning (G2 D2 A1 E1)
  \\ts (4 4)
  :4 5.4 4.3 7.3 5.2 |
  :4 5.4 4.3 7.3 5.2 |
  :4 5.3 4.2 7.2 5.1 |
  :4 5.4 4.3 7.3 5.2 |
  :4 7.3 6.2 5.2 4.2 |
  :4 5.4 7.4 8.4 5.4
`,
  },
];
