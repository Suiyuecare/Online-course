export function ShowcaseSurveyPreview() {
  return (
    <section className="course-runner-survey showcase-runner-survey">
      <div className="survey-scale-legend" aria-hidden="true">
        <span>1 不同意</span>
        <span>5 非常同意</span>
      </div>
      {["課程內容清楚實用", "網站操作順暢"].map((question, index) => (
        <fieldset key={question}>
          <legend>
            {index + 1}. {question}
          </legend>
          <div>
            {[1, 2, 3, 4, 5].map((rating) => (
              <label key={rating}>
                <input
                  disabled
                  name={`showcase-survey-${index}`}
                  type="radio"
                />
                <span>{rating}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button className="button" disabled type="button">
        示範模式不送出
      </button>
    </section>
  );
}
