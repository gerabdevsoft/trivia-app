export type DailyQuestion = {
  id: string;
  statement: string;
  options: string[];
  category: string;
  already_answered: boolean;
  selected_index: number | null;
  was_correct: boolean | null;
  correct_index: number | null;
  timed_out?: boolean;
  deadline_at?: string | null;
};

export type QuizResult = {
  correct: boolean;
  correct_index: number;
  points_awarded: number;
  total_points: number;
  timed_out: boolean;
  selected_index: number | null;
};

export type StoredQuizSession = {
  version: 1;
  userId: string;
  quizDate: string;
  question: DailyQuestion;
  deadline: number;
};
