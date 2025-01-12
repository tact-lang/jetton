refferenceValues = [0.0099692, 0.0053376, 0.002827999]
newValues = [0.0146844, 0.007670799, 0.004883999]

def calcAvgFeesFactor(refferenceValues, newValues):
    avgFeesFactor = []
    for i in range(len(refferenceValues)):
        avgFeesFactor.append(newValues[i] / refferenceValues[i])
    return sum(avgFeesFactor) / len(avgFeesFactor)

print(*(str(x) + " | " for x in newValues), end="")
print(round(calcAvgFeesFactor(refferenceValues, newValues), 2), end="x |")